"""Provision Forge's additive schema and absent signing key, then read back readiness.

Runs only in the trusted production deployment, using its existing credentials.
Never rotates a key, writes a candidate/approval, or changes a serving pointer.
Cloudflare responses and subprocess output stay private; errors report the step.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = "droneclear-forge"
DATABASE = "AUTONOMY_DB"
DATABASE_ID = "44950cd6-f34c-4fd2-bd2e-4dcf42aeeaf6"
SECRET_NAME = "FORGE_POLICY_SIGNING_SECRET"
MIGRATION = "migrations/0008_forge_matching_policy.sql"
STATUS_URL = "https://uas-patterns.com/api/autonomy/forge-policy/status"
WRANGLER = ["npx", "--yes", "wrangler@4.147.0"]


class ProvisioningError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def fetch_json(url, token=None):
    # Match the existing, deployed Forge/Patterns production smoke client.
    headers = {"Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
               "Cache-Control": "no-cache", "Pragma": "no-cache",
               "User-Agent": "ForgePatternsProductionSmoke/1.1 (+https://uas-patterns.com/)"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise ProvisioningError(f"Readback returned HTTP {error.code}") from None
    except (OSError, ValueError):
        raise ProvisioningError("Readback unavailable or returned invalid JSON") from None


def run_wrangler(arguments, *, input_text=None):
    environment = {**os.environ, "CI": "true", "WRANGLER_SEND_METRICS": "false"}
    try:
        result = subprocess.run(
            [*WRANGLER, *arguments], cwd=ROOT, input=input_text,
            text=True, capture_output=True, timeout=180, env=environment,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ProvisioningError("Pinned Wrangler command unavailable or timed out") from None
    if result.returncode:
        # Never echo an API response, token, stdin, or captured CLI diagnostic.
        raise ProvisioningError(
            f"Wrangler {' '.join(arguments[:3])} failed; verify Pages Edit and D1 Edit permissions")
    return result.stdout


def query_schema():
    output = run_wrangler([
        "d1", "execute", DATABASE, "--remote", "--yes", "--json",
        "--config", "wrangler.jsonc", "--command",
        "SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index','trigger')",
    ])
    try:
        results = json.loads(output)
        if (not isinstance(results, list) or not results
                or any(item.get("success") is not True for item in results)):
            raise ValueError
        return [row for item in results for row in item["results"]]
    except (ValueError, KeyError, TypeError):
        raise ProvisioningError("D1 schema inspection did not return successful JSON") from None


def normalize_sql(sql):
    return re.sub(r"\s+", " ", re.sub(r"\bIF NOT EXISTS\s+", "", sql)).strip()


def schema_needs_migration(rows, root=ROOT):
    actual = {(row["type"], row["name"]): row["sql"] for row in rows}
    prior = set()
    for path in sorted((root / "migrations").glob("000[1-7]_*.sql")):
        prior.update((kind.lower(), name) for kind, name in re.findall(
            r"CREATE\s+(TABLE|INDEX|TRIGGER)\s+(?:IF NOT EXISTS\s+)?(\w+)",
            path.read_text(), flags=re.I,
        ))
    if len(prior) < 30 or not prior.issubset(actual):
        raise ProvisioningError("Existing migrations 0001–0007 are incomplete; no schema or secret was changed")
    with sqlite3.connect(":memory:") as database:
        database.executescript((root / MIGRATION).read_text())
        expected = {(kind, name): sql for kind, name, sql in database.execute(
            "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL")}
    for key, sql in expected.items():
        if key in actual and normalize_sql(actual[key]) != normalize_sql(sql):
            raise ProvisioningError(f"Existing Forge schema conflicts at {key[1]}; no migration was applied")
    return not expected.keys() <= actual.keys()


def project_secret_state(project):
    if project.get("name") != PROJECT or project.get("production_branch") != "master":
        raise ProvisioningError("Pages project identity or production branch differs")
    binding = project.get("deployment_configs", {}).get("production", {}).get("env_vars", {}).get(SECRET_NAME)
    if binding is None:
        return "absent"
    if binding.get("type") != "secret_text":
        raise ProvisioningError("Existing Forge signing binding is not a secret; refusing to overwrite it")
    return "preserve"


def provision():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    if not re.fullmatch(r"[0-9a-f]{32}", account) or not token:
        raise ProvisioningError("Production Cloudflare credentials are missing")
    config = (ROOT / "wrangler.jsonc").read_text()
    if not re.search(r'"binding"\s*:\s*"AUTONOMY_DB".*?"database_id"\s*:\s*"' + DATABASE_ID + '"', config, re.S):
        raise ProvisioningError("Production D1 binding identity differs")
    response = fetch_json(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{PROJECT}", token)
    if response.get("success") is not True or not isinstance(response.get("result"), dict):
        raise ProvisioningError("Pages metadata inspection failed")
    secret_state = project_secret_state(response["result"])
    if schema_needs_migration(query_schema()):
        run_wrangler(["d1", "execute", DATABASE, "--remote", "--yes",
                      "--config", "wrangler.jsonc", "--file", MIGRATION])
    if schema_needs_migration(query_schema()):
        raise ProvisioningError("Forge schema readback is incomplete")
    if secret_state == "absent":
        # A separate 384-bit key stays in process memory and the CLI stdin only.
        run_wrangler(["pages", "secret", "put", SECRET_NAME,
                      "--project-name", PROJECT], input_text=secrets.token_urlsafe(48) + "\n")
        updated = fetch_json(
            f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{PROJECT}", token)
        if updated.get("success") is not True or project_secret_state(updated.get("result", {})) != "preserve":
            raise ProvisioningError("Signing secret metadata readback is incomplete")
    print(json.dumps({"schema_verified": True, "signing_secret": "created" if secret_state == "absent" else "preserved",
                      "serving_changes": False, "policy_activated": False}))


def verify_status(value):
    if (value.get("policy_id") != "forge-product-matching"
            or value.get("signing_configured") is not True
            or value.get("automatic_promotion") is not False
            or not isinstance(value.get("active_version"), str)
            or not value["active_version"]
            or type(value.get("generation")) is not int or value["generation"] < 0):
        raise ProvisioningError("Deployed Forge policy readiness is incomplete")
    return {key: value.get(key) for key in (
        "policy_id", "active_version", "shadow_version", "generation", "signing_configured", "automatic_promotion")}


def status_url():
    deployment = os.environ.get("FORGE_POLICY_DEPLOYMENT_URL", "").rstrip("/")
    if not deployment:
        return STATUS_URL
    if not re.fullmatch(r"https://[a-z0-9]+\.droneclear-forge\.pages\.dev", deployment):
        raise ProvisioningError("Unexpected production deployment readback origin")
    return deployment + "/api/autonomy/forge-policy/status"


def verify(attempts=12):
    error = None
    url = status_url()
    for attempt in range(attempts):
        try:
            print(json.dumps({"verified_url": url, **verify_status(fetch_json(url))}))
            return
        except ProvisioningError as caught:
            error = caught
            if attempt + 1 < attempts:
                time.sleep(5)
    raise error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    try:
        verify() if args.verify else provision()
    except ProvisioningError as error:
        raise SystemExit(str(error)) from None


if __name__ == "__main__":
    main()
