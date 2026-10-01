# Approved P0/P1 website repairs — 2026-09-30

The audit identified 57 items. This branch implements the 33 approved P0/P1 repairs across Forge, Patterns, the Handbook and the private dashboard. Companion repositories carry the Handbook and dashboard patches; this branch contains the shared Forge/Patterns implementation. Merge and deployment remain separate owner actions.

## Resulting behavior

- Builder handles fixed textual prices, quote/range/missing values, Unicode share links, strict CSV quoting and consistent weight totals. CSV keeps its first five columns and appends Price_Notes and Weight_Notes.
- Catalog, gallery, forecast and Clock text describes recorded evidence and uncertainty. Missing compliance evidence stays unknown. Undated, invalid, future or stale Clock inputs cannot become a live default score.
- Audit and Guide load their actual app scripts. Guide details and edit controls work with explicit browser-local save/removal. Local storage failures return errors; edits do not change published reference data. Session/camera/media-upload backend operations require their existing backend and were not expanded.
- Generated navigation preserves interleaved application imports, keeps closed drawers out of Tab order, traps focus while open and restores focus on Escape. Handbook chapter links use real anchors and labels.
- Shared reading controls and nested consent assets resolve from canonical source inputs. Navigation/popups fit the tested reading sizes. Native catalog/document/guide actions, field labels, dialog focus, contrast tokens and keyboard scroll regions repair the approved access issues.
- Selected route metadata names the actual public tools and removes stale counts. Existing canonicals, robots, sitemap and social/schema policy remain unchanged.

## Software verification

Offline source and generated builds are the primary acceptance environment. CI now installs pinned Playwright and runs real Chromium keyboard/app regressions after building. Private credentials, authenticated production content, camera access, paid model calls and hardware were not exercised.

Local acceptance: 245 JavaScript tests; 50 Python tests; both generated browser regression scripts; strict source/generated audits with no blocking findings. The companion dashboard has 17 synthetic cryptographic/auth tests; the Handbook has nine unit tests plus generated link/search/keyboard checks. The complete report and evidence archive preserve matched screenshots, 82 routes × 10 responsive sizes, automated accessibility measurements and six local Lighthouse results.

## Review considerations

Dashboard signing rejects old raw-password cookies; password users must sign in once again after deployment. Access JWT trust requires the existing optional issuer/audience configuration. Exact-five-column CSV consumers must accept the appended note columns. Guide edits remain in the current browser and can be lost if browser storage is cleared.

This is the approved priority repair set, not a complete accessibility or factual certification. The 24 P2/P3 audit items remain deferred. Known residuals include summary/target/ARIA semantics on specific routes, small-phone overflow on Industry/Lexicon, external-CDN-dependent graph coverage, placeholder/default metadata/social assets, and the Handbook's heavy single-page mobile rendering. Production revision parity, native screen-reader checks and field INP remain unverified.
