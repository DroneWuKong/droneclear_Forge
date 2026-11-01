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
   Force-cancelled the obsolete run `40080946727` after normal cancellation
   left its serial jobs active, restored GupC's existing service,
   and installed a scoped systemd drop-in with `Restart=on-failure`,
   `RestartSec=30s`, `OOMPolicy=kill`, and `CARGO_BUILD_JOBS=2`.
   GupA was not used for development builds.
2. **Stale live data:** the event-cluster, quality-score, and coverage APIs
   returned 503 for October 23 datasets. The catalog honestly reported 15 stale
   datasets and one invalid entity graph. The brief repair run
   [41305846848](https://github.com/DroneWuKong/Ai-Project/actions/runs/41305846848)
   succeeded after runner recovery; live brief generation was independently
   read back as `2026-11-01T18:21:53.845Z`. The full daily run
   [41302242765](https://github.com/DroneWuKong/Ai-Project/actions/runs/41302242765)
   also succeeded. Live catalog counts improved to 19 fresh, three stale,
   one delayed, seven reference, and zero invalid datasets. The dedicated lens refresh
   [41337937793](https://github.com/DroneWuKong/Ai-Project/actions/runs/41337937793)
   succeeded. The catalog's first recovery attempt correctly rejected a
   concurrent collector conflict. Its second attempt succeeded after the
   overlapping miner was stopped. Live readback at approximately 19:05 UTC
   confirmed **23 fresh current datasets, seven available reference datasets,
   zero stale/delayed/invalid datasets**. Cluster, coverage, catalog, quality,
   brief and health endpoints returned HTTP 200.
   [Production smoke 41339882004](https://github.com/DroneWuKong/droneclear_Forge/actions/runs/41339882004)
   passed, including corpus parity and freshness requirements.
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
   trees. The workspace Vite override and security-floor check were also patched to
   `6.4.5` for [GHSA-8g5g-mxqh-grgj](https://github.com/advisories/GHSA-8g5g-mxqh-grgj).
   Separate Prime/SvelteKit and Rustls advisories in Ai-Project are outside
   this website/pipeline repair and were not silently marked resolved.
7. **Accessibility:** the private supply-web dossier reset button lacked a name.
   Added visible fallback text; both complete source and built-site audits now
   report zero findings and warnings.
8. **Portfolio credential:** the scheduled release-manifest refresh fails with
   an invalid stored token. A local refresh using existing CLI access succeeded
   for all ten manifests. Both existing readers (`HANGAR_DASHBOARD_READ` and `HANGAR_PAT`) failed
   a private-repository read in branch run
   [41338267031](https://github.com/DroneWuKong/UAS-Portfolio/actions/runs/41338267031).
   The workflow now tries configured readers and reports a specific setup error.
   The user explicitly approved reuse of the working CLI credential, which
   was stored as `PORTFOLIO_READ_TOKEN` at 19:08 UTC. Token values were not printed.
   The next run read all ten repositories, then exposed a separate publication
   failure: direct pushes to main were correctly blocked by repository rules.
   [PR #60](https://github.com/DroneWuKong/UAS-Portfolio/pull/60) now publishes on
   an automation branch, opens a PR, waits for product identity validation, and
   merges through the normal rules with the exact proposed head. Failed checks
   preserve the proposal; unrelated staged files and feature-branch publication
   are rejected. The repository's auto-merge setting and bypass permissions were
   unchanged. Five real-Git regression tests and the required CI check passed.
   Production [run 41340606856](https://github.com/DroneWuKong/UAS-Portfolio/actions/runs/41340606856)
   succeeded, read all ten source repositories, opened
   [manifest PR #61](https://github.com/DroneWuKong/UAS-Portfolio/pull/61), and
   merged it after the required check passed. Credential and publication failures
   are resolved.

9. **Immutable recorder release:** npm tooling changes triggered a redundant
   publication attempt for native recorder v1.3.1. The publisher now compares
   bundled source, build scripts, and shipped docs with the exact original
   release commit. Identical inputs retain the existing release without writes;
   changed inputs, drafts from another commit, and comparison errors remain
   blocked. Both Windows and Linux CI passed the new regression tests.
   Post-merge [run 41338397830](https://github.com/DroneWuKong/droneclear_Forge/actions/runs/41338397830)
   completed successfully, including the publication job, retaining v1.3.1.

10. **Concurrent data writers:** the catalog and miners used different workflow
   groups and changed the same article/DFR files during recovery. Publication
   correctly refused to overwrite newer evidence. The scheduling repair assigns
   every shared-publisher job the same concurrency lock from checkout through
   generation and push. `queue: max` retains pending jobs and workflows; a
   reusable workflow caller never holds the lock while awaiting its child.
   The repair from [PR #807](https://github.com/DroneWuKong/Ai-Project/pull/807)
   is consolidated into [PR #806](https://github.com/DroneWuKong/Ai-Project/pull/806). See
   [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
   Twenty-six workflow, integrity, and conflict-preservation tests passed.
   A subsequent fallback-sync attempt explicitly reported `22609` versus `22742`
   input articles and preserved the prior fallback, demonstrating why publishing
   a fresh timestamp alone is insufficient. The original uncoordinated miner
   run was stopped after preserving its
   committed collector results; recovery uses the latest generated-data branch.

11. **Partner-login test timing:** public quality run
   [#472](https://github.com/DroneWuKong/droneclear_Forge/actions/runs/41344456685)
   crossed the 20:00 UTC boundary of the existing 15-minute login limit. Its
   eleventh guess correctly entered a new window and returned 401, while the
   test expected 429 from a single-window sequence. Only the catalog JSON had
   changed in that commit. Subsequent quality runs #473 and #474 and production
   smoke passed. The local Worker fixture now supports an explicit clock; the
   test exercises eleven attempts one millisecond before rollover, then verifies
   fresh IP/email counters at the exact boundary. Production authentication and
   rate limits are unchanged.

## Verification

| Check | Result |
| --- | --- |
| Partner account/security regressions after clock repair | 22 passed, including explicit fixed-window rollover |
| Forge Python | 142 tests and 53 subtests passed |
| Forge Node / Workers runtime, patched dependencies | 411 passed |
| Forge source audit, `--all --strict --require-catalog` | 102 HTML files, 30 datasets; zero findings/warnings |
| Forge built audit with the same flags | 103 HTML files, 30 datasets; zero findings/warnings |
| Live production smoke after recovery | Passed locally and in GitHub Actions; live catalog 23 fresh + 7 reference, no stale or invalid datasets |
| Live Forge and Patterns route sweep | 200 URLs; 182 successful public responses, 18 expected private 401 responses |
| Patterns Python pipeline suite | 1007 tests and 363 subtests passed; unrelated RTSP test excluded |
| Frontend after Vite patch | 1,013 tests in 183 files and production build passed |
| Miners-cron | 8 tests passed; Wrangler dry-run build succeeded |
| Handbook Python | 60 passed |
| Handbook Node / SQLite API | 33 passed |
| Handbook links | All 407 internal relative links resolved |
| Handbook generated site and evidence boundaries | Passed |
| Handbook full browser suite after rendering repair | Passed; zero page errors; final run also verifies full print rendering |
| Handbook Pages Functions | Compiled successfully |
| Handbook repaired production | Exact commit `1e87707e36435f4d4400fd64c897b35d2d6be637`, release `7a849a6187c1c485d9d9`, durable storage, review and attachments verified |
| Portfolio protected publication | Five real-Git regressions passed; production refresh read all ten repositories and merged PR #61 through the required check |
| npm audit, all three affected package trees | Zero vulnerabilities after patched overrides |

The Handbook evidence audit retains 5,264 unreviewed records out of 5,308 tracked
records. Passing software checks does not make these claims source-supported.

## Release tracking

- Merged: [Forge repair PR #216](https://github.com/DroneWuKong/droneclear_Forge/pull/216)
- Merged: [Patterns repair PR #806](https://github.com/DroneWuKong/Ai-Project/pull/806)
- Merged: [Handbook repair PR #88](https://github.com/DroneWuKong/drone-integration-handbook/pull/88)
- Merged: [Portfolio manifest PR #58](https://github.com/DroneWuKong/UAS-Portfolio/pull/58)
- Merged: [Recorder release repair PR #217](https://github.com/DroneWuKong/droneclear_Forge/pull/217)
- Merged: [Portfolio protected-publication PR #60](https://github.com/DroneWuKong/UAS-Portfolio/pull/60)
- Merged: [Portfolio reader-selection PR #59](https://github.com/DroneWuKong/UAS-Portfolio/pull/59)
- Forge production deployments of `df468441c639af05b58a25ee85de00fa29b68493` and recorder follow-up `1c8d427add9cb69ba4a04fe16a344bfbb11d8f16` passed.
- Patterns PR #806 merged at 19:51 UTC as
  `035b44b500a3fe1802b264d2aeef5cb4fafbb68a` after all required packaging checks
  passed, including Windows, Linux, Android, and the connected update kit.
  The source repairs and writer scheduling are now on main.
- Scheduling PR #807 was closed after incorporation into #806, avoiding two
  successive full native packaging gates for the same repair.
- Handbook production was read back at the exact merged commit, with durable capabilities enabled.
- Catalog recovery and live production smoke passed. Final
  [fallback-sync run 41339879820](https://github.com/DroneWuKong/droneclear_Forge/actions/runs/41339879820)
  succeeded against the consistent recovered snapshot.

GupC had only about 2.5 GB of free disk when recovered. Runner recovery does not
resolve capacity limits. Free space subsequently reached approximately 6.8 GB (still 99% used). Existing receipts and unrelated caches were retained.
