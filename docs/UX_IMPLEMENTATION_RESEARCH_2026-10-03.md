# UX implementation research and release contract

The simplification is implemented in draft PR #174 and a companion Handbook branch. Production is unchanged. This document distinguishes implemented behavior, software evidence and remaining release gates.

## Research decisions

| Question | Evidence | Implementation decision |
|---|---|---|
| What kind of navigation is this? | [W3C disclosure navigation](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/) describes ordinary navigation links and disclosures without application-menu semantics. | Keep native links and details/summary groups. Research, Build and Learn are the three entrances; searchable All tools holds the long tail. |
| How should a mobile drawer behave? | [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) specifies inert background, contained keyboard focus, Escape and restored focus. | Preserve Forge's focus behavior; repair Handbook drawer timing/inert state and mutually exclusive search/drawer dialogs. Collapse chapter groups initially. |
| Can builds silently follow the user between domains? | [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) is origin-specific and may be unavailable. | Browser-local storage is explicitly labeled. Do not claim cross-domain sync. Share/export remains the portable path. |
| What happens when storage fails or another tab edits? | [MDN storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event) and [storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria). | Validate first, retain legacy bytes, catch denied/quota writes, compare stored bytes before saving, and warn on other-tab changes. This detects stale sequential writes, but localStorage is not a transactional database and simultaneous writes are not guaranteed serializable. |
| Does this need a separate worker deployment? | Repository `functions/api/[[path]].js` imports `workers/index.js`; [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/) and [preview deployments](https://developers.cloudflare.com/pages/configuration/preview-deployments/). | Deploy the matching Pages static output and bundled Functions. Validate preview bindings and API scope contract. Corrects the earlier plan's separate-worker assumption. |

## Build data contract

`forge.builds.v1` stores schema version 1, active build ID and named builds. Each item has a stable part ID, integer quantity, display name and category. Limits: 50 builds, 1,000 distinct items per build, quantity 1–999. Missing catalog IDs remain visible. Unit cost/weight stay separate from quantity-adjusted totals; unknowns remain unknown and quoted/range prices are excluded from known totals.

Opening the old `forge-build` array is a read-only migration until the next explicit edit. Its original bytes are retained. Corrupt or unsupported saved data is never reset automatically. Shared links accept legacy PID arrays and new schema-2 quantity payloads. Opening a shared list creates a separate unsaved build; it does not overwrite existing work. Storage failure leaves edits available in memory and through share/export.

| Surface | Reads | Writes | Return behavior |
|---|---|---|---|
| Builder | Named builds, quantities, catalog | New schema only after user edits | Active build ID |
| Cost | Named build or shared snapshot plus catalog | None | Selected build ID or original shared snapshot |
| Home | Active build name/ID | None | Resume active build |
| Guide / Audit / Stack / Wiring | Active build name and parts as disclosed reference | None through the new adapter | Return to same saved build |

Specialist tools keep their own inputs. Automatic part-to-wiring, guide-state or assembly mapping is deliberately not asserted. It needs a documented adapter and separate validation for each tool.

## News contract

The UAS filter runs over the full research index before pagination; the UI requires the server's scope echo. It matches explicit aerial-system terms in article content, not publisher/entity labels, and strips a known repeated publisher tagline. RPAS is included. Unmatched category is unclassified. Reference records remain separate from dated articles. Future and unknown dates are labeled and do not displace valid recent dates.

Changing scope resets incompatible filters. A failed scope switch preserves the previous results and scope; initial news failure still permits reference desks to load. A different input revision during pagination is rejected to avoid mixing snapshots.

A 24-record exploratory review (12 text matches and 12 nonmatches, evenly spaced in the local corpus) exposed the difference between direct UAS reporting and incidental drone mentions, and ambiguous conflict headlines without specified weapon type. It is a regression exploration, not a representative labeled evaluation. No precision/recall is claimed. Before tuning ranking, label a stratified sample across languages, publishers and article dates, include incidental mentions and unknown cases, and measure both false positives and false negatives.

## Verification and rollout

- Python public-site fixtures: 52 passing cases locally before final publication.
- Focused and broader Node regression files passed locally, including storage migration, quantity arithmetic, legacy shares, Unicode shares, unsupported schema, quota errors, stale-tab writes, full-corpus filtering and date boundaries.
- All four no-write integration patch checks pass after replacing obsolete copy assertions with preserved route assertions and retiring checks for removed duplicate marketing cards.
- Offline Forge build and static source/generated audits run against local inputs; these do not establish live ingestion health. Latest audit has no blocking findings and one pre-existing hidden private-dossier button warning.
- Handbook full build: 52 chapters, 39 platforms, 61 component references; five fixture cases and JavaScript syntax check pass.
- CI browser journeys exercise 390px navigation, keyboard behavior, named build/quantity/Cost return, legacy share isolation, directory search, research save/restore and news scope using controlled API fixtures. Their result must be checked on the final commit.
- Authorized hosted-preview review completed on 2026-10-03 after normal Cloudflare Access sign-in. Live checks covered the shared task navigation, saved build quantity/Cost flow, research retrieval and packet saving, directory search, UAS News pagination (200 loaded of 6,355 matches) and full-corpus switching (100 loaded of 16,965 articles). Counts are observations at review time, not stable product limits.
- Live review exposed Builder overlay/header overlap. The build drawer now sits above shared navigation, and the part dialog close button sits above its header. New pointer-close checks cover both at 390px and 1440px; the full Forge quality run 37144442598 passed on functional commit 6804f298413372232f954efd97d8f76904e87569. Hosted pointer closes were then verified.
- Handbook hosted desktop home and troubleshooting search starter were reviewed on a0669e0a641cd0e639dfff4fad92051c1c9fed5a. Full Handbook CI run 37141732493 passed, including mobile/desktop screenshots, reduced motion, drawer focus and search interaction. Mobile evidence comes from CI, not resizing the hosted browser. Private authenticated tools were not exercised; their access controls remain unchanged.

Implementation and preview review are ready for the owner's merge/deploy decision. The PRs remain draft and production is unchanged. This final record update changes documentation only; the functional commit and CI run above identify the tested code. Monitor API errors and failed task reports; roll back the matched Pages release on regression. Retain the original local build key across rollout and rollback.

After release, observe new and returning users finding today's change, researching a cited question, resuming a build and finding a specialist tool. Record completion, wrong turns and time before deciding further removals.
