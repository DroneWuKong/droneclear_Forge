# Forge, Patterns, Handbook, and portfolio audit — 2026-11-01

This is an operational and software audit, not a certification of every factual
claim, a hardware qualification, or proof that an unmerged repair is deployed.

## Sources and scope

The repositories were discovered using `octo-workspace repos` and
`octo-workspace checkouts`, migration receipts, and verified Git remotes.
Separate worktrees under `/srv/dev-rig/workspaces/dronewukong/worktrees/`
named `{Forge,Ai-Project,Handbook,UAS-Portfolio}-ecosystem-audit-20261101`
preserve existing branches and dirty checkouts. Each uses
`fix/ecosystem-audit-20261101` in its own repository.

Initial default-branch revisions:

| Repository | Revision |
| --- | --- |
| droneclear_Forge | `17ed5ade666ec390b12e8ddf99d2e524e4d1d0f6` |
| Ai-Project | `f9ead92ef6bb439991d5684c26c6bf69f0a0baa1` |
| drone-integration-handbook | `2132e1974c458f995c5b6711d3359a00faab8888` |
| UAS-Portfolio | `79b0cb026d0b5b78396b5a1bd3d2271d8a7fc6db` |

## Findings and repairs

1. **Data publication outage:** GupC's Ai-Project runner stopped after an OOM on
   October 23. GupB's older runner service also recorded an OOM on October 14.
   GitHub's only registered Ai-Project runner was offline. A miner run from
   October 24 was still queued and newer publications were pending or cancelled.
   Cancelled the obsolete run `40080946727`, restored GupC's existing service,
   and installed a scoped systemd drop-in with `Restart=on-failure`,
   `RestartSec=30s`, `OOMPolicy=kill`, and `CARGO_BUILD_JOBS=2`.
   GupA was not used for development builds.
2. **Stale live data:** the event-cluster, quality-score, and coverage APIs
   returned 503 for October 23 datasets. The catalog honestly reported 15 stale
   datasets and one invalid entity graph. The brief repair run
   [41305846848](https://github.com/DroneWuKong/Ai-Project/actions/runs/41305846848)
   succeeded after runner recovery; live brief generation was independently
   read back as `2026-11-01T18:21:53.845Z`. Full daily publication and the miner
   backlog require separate terminal-state and live-freshness verification.
3. **Lens-sync diagnostics:** unsuccessful snapshot selection discarded every
   validator rejection. The repair writes a separate failure receipt and uploads
   it from Actions while preserving previous validated data and its success
   receipt. Freshness and consistency requirements remain enforced.
4. **Cross-platform experiment hashes:** inherited `core.autocrlf=true` changed
   archived checkout bytes, breaking seven tests. Exact Git archive bytes matched
   the original registry. Checkout attributes now preserve those bytes and the
   protected fixtures. No historical hashes or evidence were rewritten. A real
   Git checkout regression test covers this configuration.
5. **Handbook reading-size performance:** the complete browser suite repeatedly
   timed out after 30 seconds inside reading-size changes. Offscreen chapter
   rendering and nearby-only, batched scroll-region measurement let the same
   complete suite pass in approximately 13 seconds. Printing explicitly renders
   every chapter. Search, keyboard access, offline recovery, and no-JavaScript
   access are covered by the browser suite.
6. **Vulnerable tooling:** npm audits found vulnerable `undici` and `sharp`
   dependencies in Forge, Handbook, and the miners-cron package. Patched versions
   `7.30.1` and `0.35.5` clear all reported vulnerabilities in those three package
   trees. Separate Prime/SvelteKit and Rustls advisories in Ai-Project are outside
   this website/pipeline repair and were not silently marked resolved.
7. **Accessibility:** the private supply-web dossier reset button lacked a name.
   Added visible fallback text; both complete source and built-site audits now
   report zero findings and warnings.
8. **Portfolio credential:** the scheduled release-manifest refresh fails with
   an invalid stored token. A local refresh using existing CLI access succeeded
   for all ten manifests. Persistent credential replacement awaits explicit
   permission to reuse the CLI credential, or a dedicated repository reader
   supplied through GitHub settings. Token values were not printed.

## Verification

| Check | Result |
| --- | --- |
| Forge Python | 142 tests and 53 subtests passed |
| Forge Node / Workers runtime, initial full run | 411 passed |
| Forge source audit, `--all --strict --require-catalog` | 102 HTML files, 30 datasets; zero findings/warnings |
| Forge built audit with the same flags | 103 HTML files, 30 datasets; zero findings/warnings |
| Live Forge and Patterns route sweep | 200 URLs; 182 successful public responses, 18 expected private 401 responses |
| Patterns Python pipeline suite | 1007 tests and 363 subtests passed; unrelated RTSP test excluded |
| Miners-cron | 8 tests passed; Wrangler dry-run build succeeded |
| Handbook Python | 60 passed |
| Handbook Node / SQLite API | 33 passed |
| Handbook links | All 407 internal relative links resolved |
| Handbook generated site and evidence boundaries | Passed |
| Handbook full browser suite after rendering repair | Passed; zero page errors; final run also verifies full print rendering |
| Handbook Pages Functions | Compiled successfully |
| Handbook production before repair | Exact commit, release marker, durable storage and attachment capabilities verified |
| npm audit, all three affected package trees | Zero vulnerabilities after patched overrides |

The Handbook evidence audit retains 5,264 unreviewed records out of 5,308 tracked
records. Passing software checks does not make these claims source-supported.

## Release tracking

- [Forge repair PR #216](https://github.com/DroneWuKong/droneclear_Forge/pull/216)
- [Patterns repair PR #806](https://github.com/DroneWuKong/Ai-Project/pull/806)
- [Handbook repair PR #88](https://github.com/DroneWuKong/drone-integration-handbook/pull/88)
- [Portfolio manifest PR #58](https://github.com/DroneWuKong/UAS-Portfolio/pull/58)
- Final merge, deployment readback, and fresh-data recovery results remain separate checks.

GupC had only about 2.5 GB of free disk when recovered. Runner recovery does not
resolve capacity limits. Existing receipts and unrelated caches were retained.
