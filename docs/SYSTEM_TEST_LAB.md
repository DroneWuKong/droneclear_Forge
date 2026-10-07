# Forge System Test Lab

Public route: `/test-lab/`. The tools directory and software library link to it.
General checks are inherited by both requirement profiles. The public download
is newly authored MIT-licensed code, with Python standard-library dependencies.
No private Gauntlet runner, Prismo implementation, historical receipt or private
DDG tracker is copied or exposed.

The download is generated from five allowlisted files under
`forge-source/system-tests/`, with normalized line endings, reproducible ZIP
metadata and published SHA-256 sums. Source-profile bytes are shared by the
runner and browser. Changing a profile requires a version and source review;
the browser rejects reports from different profile bytes or versions.

The runner checks declared release identity, expected artifact/document bytes
and explicitly configured local adapters. Commands require `--execute` and run
without shell interpolation. Human/external gates remain open. The empty config
produces blocked results. Adapter logs remain local and are hashed but discarded;
users must retain their own detailed evidence. Output files cannot overwrite
existing files or the toolkit. Automated gaps keep the CLI exit code nonzero;
exit zero reports only automated checks, never human or external acceptance.

Browser imports are unverified historical assertions, even when structurally
valid. Details render as text. The importer cannot turn manual or external gates
into passes. Review notes and report bytes are held in memory and exported only
as a local download; normal site page analytics do not receive these values.

## Requirement source review, 2026-10-07

The current official program homepage links to Phase 3 RFS Rev3 and DDPSCF v2.
Downloaded PDFs were text-extracted for review. The catalogue records exact URLs
and original-byte hashes; PDFs are linked, not redistributed in the toolkit.

- RFS Rev3 SHA-256: `c6c0242dcd969248a240e173f839fb76a730a7ee8204323911d5051cc9d5f456`.
- DDPSCF v2 SHA-256: `dd966ad56fd8e18b3c22d9954eef6dbcc4804c0e7aae6bba7fa06fff01dc5850`.
- Gauntlet additions inventory selected manuals, supplier and source-provenance
  documents; byte checks do not assess substantive requirements or participation.
- DoW additions use selected NIST SSDF 1.1 practice identifiers, not a claim that
  SSDF alone supplies every contract or organizational requirement.
- Official physical, supply-chain, organizational and program acceptance stay
  outside the software runner. No weapon or payload testing is implemented.

## Validation

Run `python3 -m unittest tests/test_system_test_lab.py`,
`node --test tests/test_system_test_lab.cjs`, an offline site build and
`node tests/browser_system_test_lab.cjs build`. The public-site quality workflow
runs these checks with existing source/built-route audits. Browser fixture reports
verify the page only and are never evidence about a visitor's system.
