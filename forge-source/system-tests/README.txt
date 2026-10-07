FORGE SYSTEM TEST LAB — 1.0.0

Python 3.9+; standard library only. Windows, Linux and macOS.
Download and extract the bundle. No account, AI service or upload is required.
This newly authored toolkit is separate from private Prismo/Gauntlet code.
Permission to reuse this toolkit is in LICENSE.txt.

1. Copy config.example.json to a file OUTSIDE the extracted toolkit folder.
2. Fill in your system name, release version, and exact source commit (40 or
   64 lowercase hex characters). This is your declaration, not authentication.
3. List release artifacts with relative paths and independently recorded
   expected SHA-256 values. All file paths resolve under --system-root.
4. Add your own local software test adapters. Review commands before running.
   Adapters must make meaningful assertions, return zero only on success,
   operate in a disposable software environment, and clean up their services.
   Use absolute executable paths when needed. No shell expansion is performed.
5. Run the preflight; then add --execute to actually run configured commands.
6. Import the resulting JSON at https://uas-forge.com/test-lab/ for review.
   Forge reads it in your browser. Review it before sharing with another person.

EXAMPLE (run from a working directory outside the extracted toolkit folder):
python /path/to/toolkit/run_tests.py --profile general --config system.json \
  --system-root /path/to/your/system --output general-report.json

Replace "python" with "python3" if required. Windows users can use "py -3" and
Windows paths. Use a new output filename for every run; existing files are not
overwritten. Select gauntlet or dow to add their checks to the general profile.

CONFIGURATION EXAMPLES (replace every example value with your own):
"artifacts": [{"path": "dist/app.zip", "sha256": "64-lowercase-hex-digest"}]
"commands": {
  "smoke": {"argv": ["python3", "tests/smoke.py"], "timeout_seconds": 60},
  "lifecycle": {"argv": ["python3", "tests/lifecycle.py"], "timeout_seconds": 60},
  "input_rejection": {"argv": ["python3", "tests/invalid_inputs.py"], "timeout_seconds": 60},
  "recovery": {"argv": ["python3", "tests/recovery.py"], "timeout_seconds": 60},
  "restore": {"argv": ["python3", "tests/restore.py"], "timeout_seconds": 60},
  "permissions": {"argv": ["python3", "tests/permissions.py"], "timeout_seconds": 60},
  "vulnerabilities": {"argv": ["python3", "tests/dependency_policy.py"], "timeout_seconds": 120},
  "security": {"argv": ["python3", "tests/security.py"], "timeout_seconds": 120}
}
"documents": {
  "gauntlet_rfs": {"path": "docs/phase3-rev3.pdf", "sha256": "c6c0242dcd969248a240e173f839fb76a730a7ee8204323911d5051cc9d5f456"},
  "operator_manual": {"path": "docs/operator.pdf", "sha256": "64-lowercase-hex-digest"},
  "maintenance_manual": {"path": "docs/maintenance.pdf", "sha256": "64-lowercase-hex-digest"},
  "supplier_bom": {"path": "docs/bom.csv", "sha256": "64-lowercase-hex-digest"},
  "repository_provenance": {"path": "docs/repository-provenance.json", "sha256": "64-lowercase-hex-digest"},
  "requirements_mapping": {"path": "docs/requirements.csv", "sha256": "64-lowercase-hex-digest"},
  "sbom": {"path": "docs/sbom.json", "sha256": "64-lowercase-hex-digest"},
  "remediation": {"path": "docs/remediation.csv", "sha256": "64-lowercase-hex-digest"}
}

The empty starter intentionally leaves checks BLOCKED. There are no fake test
commands, prefilled pass claims, or simulated results for your system.

RESULTS AND LIMITS
pass: exact file bytes match, identity fields are present, or your adapter
returned zero. These narrow results do not establish content correctness.
fail: bytes differ, a file is missing, or an adapter failed/timed out.
blocked: configuration is missing/invalid or a local operation was unavailable.
not_run: a command was configured but --execute was not supplied.
review_required: a human must assess the listed evidence and procedure.
external_required: this toolkit cannot establish the requested acceptance.
Exit 0: all automated checks passed; human and external gates still remain open.
Exit 1: an automated check is blocked, failed or not run.
Exit 2: invalid configuration or report/output error. Exit 0 is not acceptance.

The runner does not scan remote systems, install applications, enroll trust,
touch devices, or collect credentials. Your configured adapters run with your
own user's permissions: review them and their effects first. On POSIX a timed
out adapter process group is killed; on Windows its parent is stopped, so
adapters must manage and clean up any child services themselves.
Adapter output is hashed locally but is not retained or uploaded. Save your
test logs separately when reviewers need them; the report contains no raw
stdout/stderr or command arguments. No sensitive logs belong on public Forge.
Document checks verify presence and bytes, not authenticity, technical meaning,
supplier eligibility, legal compliance or government approval.

The Gauntlet profile is a LIMITED document-preparation subset tied to Phase 3
RFS Rev3 and DDPSCF v2, reviewed 2026-10-07. Recheck official sources before use;
changed documents require a new reviewed profile. It does not reproduce the
official physical competition or implement payload/weapon tests.
The DoW profile uses selected NIST SSDF 1.1 practices for software preparation.
It is not a universal DoW requirements list; your contract and assessed scope
determine applicability. CMMC, supply chain, independent review, physical and
program acceptance are external. There is no certificate or qualification.
