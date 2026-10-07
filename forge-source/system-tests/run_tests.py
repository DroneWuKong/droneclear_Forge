#!/usr/bin/env python3
"""Forge System Test Lab: local software checks, using only Python's standard library."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

VERSION = "1.0.0"
HERE = Path(__file__).resolve().parent
STATES = {"pass", "fail", "blocked", "not_run", "review_required", "external_required"}


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1048576), b""):
            result.update(chunk)
    return result.hexdigest()


def read_json(path):
    if path.stat().st_size > 1048576:
        raise ValueError("JSON input exceeds 1 MiB")
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result
    def reject_constant(value):
        raise ValueError("Non-finite JSON value")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=pairs, parse_constant=reject_constant)


def selected_checks(catalog, profile):
    checks = list(catalog["profiles"]["general"]["checks"])
    if profile != "general":
        checks.extend(catalog["profiles"][profile]["checks"])
    return checks


def artifact(root, spec, expected=None):
    if not isinstance(spec, dict) or set(spec) != {"path", "sha256"}:
        return "blocked", "Supply a local path and expected SHA-256.", []
    if not isinstance(spec["path"], str) or not spec["path"] or not re.fullmatch(r"[0-9a-f]{64}", str(spec["sha256"])):
        return "blocked", "Supply a local path and a lowercase 64-character SHA-256.", []
    relative = Path(spec["path"])
    resolved = (root / relative).resolve()
    if relative.is_absolute() or not resolved.is_relative_to(root):
        return "blocked", "Artifact must resolve within the selected system directory.", []
    if not resolved.is_file():
        return "fail", "Configured artifact is missing.", []
    actual = digest(resolved)
    evidence = [{"path": relative.as_posix(), "sha256": actual}]
    if actual != spec["sha256"] or (expected and actual != expected):
        return "fail", "Artifact does not match the expected bytes.", evidence
    return "pass", "Expected local bytes found; content and authenticity need review.", evidence


def command_check(root, spec, execute):
    if not isinstance(spec, dict) or set(spec) != {"argv", "timeout_seconds"}:
        return "blocked", "Configure an argument array and timeout for your own test adapter.", []
    argv, timeout = spec["argv"], spec["timeout_seconds"]
    if not isinstance(argv, list) or not 1 <= len(argv) <= 64 or any(not isinstance(x, str) or not x or len(x) > 4096 or "\0" in x for x in argv):
        return "blocked", "Adapter arguments are invalid.", []
    if type(timeout) not in (int, float) or not 0 < timeout <= 600:
        return "blocked", "Adapter timeout must be greater than zero and at most 600 seconds.", []
    if not execute:
        return "not_run", "Adapter configured; rerun with --execute after reviewing your commands.", []
    # Output remains local and is omitted from the report. Its digest records the
    # exact adapter output; it is neither source authentication nor semantic proof.
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(argv, cwd=root, stdout=output, stderr=subprocess.STDOUT,
                                   shell=False, start_new_session=os.name == "posix")
        try:
            code = process.wait(timeout=timeout)
            state = "pass" if code == 0 else "fail"
            detail = f"User adapter exited {code}; passing means its exit-code assertion passed."
        except subprocess.TimeoutExpired:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait()
            state, detail = "fail", "Adapter exceeded its configured timeout."
        output.seek(0)
        result = hashlib.sha256()
        for chunk in iter(lambda: output.read(1048576), b""):
            result.update(chunk)
    return state, detail, [{"adapter_output_sha256": result.hexdigest()}]


def run(config, catalog, profile, root, execute=False, config_digest=None):
    if not isinstance(config, dict) or set(config) - {"schema_version", "system", "artifacts", "commands", "documents"} or type(config.get("schema_version")) is not int or config["schema_version"] != 1:
        raise ValueError("Unsupported configuration")
    if not isinstance(config.get("system"), dict) or set(config["system"]) != {"name", "version", "source_commit"}:
        raise ValueError("Supply system name, version and source_commit fields")
    if any(not isinstance(x, str) or len(x) > 200 for x in config["system"].values()):
        raise ValueError("System identity fields must be strings of at most 200 characters")
    for key in ("commands", "documents"):
        if not isinstance(config.get(key, {}), dict):
            raise ValueError("Commands and documents must be objects")
    artifacts = config.get("artifacts", [])
    if not isinstance(artifacts, list) or len(artifacts) > 100:
        raise ValueError("Supply at most 100 artifacts")
    rows = []
    for check in selected_checks(catalog, profile):
        kind = check["kind"]
        try:
            if kind == "identity":
                system = config["system"]
                valid = all(system.values()) and re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", system["source_commit"])
                state, detail, evidence = ("pass" if valid else "blocked"), "Declared system identity; source checkout is not independently authenticated.", []
            elif kind == "artifacts":
                if not artifacts:
                    state, detail, evidence = "blocked", "Configure at least one release artifact with an expected digest.", []
                else:
                    results = [artifact(root, spec) for spec in artifacts]
                    state = "fail" if any(x[0] == "fail" for x in results) else "blocked" if any(x[0] == "blocked" for x in results) else "pass"
                    detail = "Release-byte verification only; authenticity and behavior need separate evidence."
                    evidence = [e for row in results for e in row[2]]
            elif kind == "command":
                state, detail, evidence = command_check(root, config.get("commands", {}).get(check["key"]), execute)
            elif kind == "document":
                state, detail, evidence = artifact(root, config.get("documents", {}).get(check["key"]), check.get("expected_sha256"))
            else:
                state = "external_required" if kind == "external" else "review_required"
                detail, evidence = check["procedure"], []
        except (OSError, ValueError):
            state, detail, evidence = "blocked", "Local file or adapter could not be accessed; inspect your configuration.", []
        rows.append({"id": check["id"], "kind": kind, "status": state, "detail": detail, "evidence": evidence})
    return {
        "schema_version": 1, "tool": "forge-system-test-lab", "tool_version": VERSION,
        "profile": profile, "profile_version": catalog["version"],
        "catalog_sha256": digest(HERE / "profiles.json"), "config_sha256": config_digest,
        "recorded_at": datetime.now(timezone.utc).isoformat(), "system": config["system"],
        "scope": "local_software_preparation", "certification": False, "program_acceptance": False,
        "commands_executed": execute, "results": rows,
        "summary": {state: sum(row["status"] == state for row in rows) for state in sorted(STATES)},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", choices=["general", "gauntlet", "dow"], default="general")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--system-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("forge-test-report.json"))
    parser.add_argument("--execute", action="store_true", help="Run your explicitly configured software test commands")
    args = parser.parse_args()
    try:
        root = args.system_root.resolve(strict=True)
        if not root.is_dir():
            raise ValueError("System root must be a directory")
        output = args.output.resolve()
        # Never overwrite configuration, toolkit files, or any preexisting report.
        if output.exists() or output.is_relative_to(HERE) or output == args.config.resolve():
            raise ValueError("Select a new report path outside the toolkit directory")
        report = run(read_json(args.config), read_json(HERE / "profiles.json"), args.profile,
                     root, args.execute, digest(args.config))
        with output.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report["summary"]))
        print("Local software report written. Review and external acceptance remain separate.")
        return 1 if any(row["status"] != "pass" and row["kind"] not in {"review", "external"} for row in report["results"]) else 0
    except (OSError, ValueError, TypeError, KeyError):
        print("Configuration or report path rejected; check README.txt. No input contents printed.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
