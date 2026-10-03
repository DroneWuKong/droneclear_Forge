# UAS simplification: audit and implementation plan

The product needs three clear entrances: **Research (Patterns), Build (Forge), Learn (Handbook)**. Task pages should show useful work before directories and diagnostics. Existing specialist tools and public evidence remain reachable; private tools retain their existing access boundary.

## Findings and repairs

| Priority | Finding | Fix | Acceptance |
|---|---|---|---|
| P0 | Shared drawer had 57 nested links; host matching opened multiple sections | Three task groups, one active expansion, native disclosure behavior; All tools and Data status secondary | Keyboard focus trap, Escape, restoration and active-page state preserved |
| P0 | Forge root and `/forge/` were competing directories with conflicting counts and claims | One build home, generated identically at both paths; resume current build | Both routes identical; no hardcoded catalog totals |
| P0 | Patterns showed a large hero, five CTAs and data dashboard before the daily workspace | Short introduction, two actions, daily workspace first; expandable coverage below | Mobile can reach useful work without scrolling through diagnostics |
| P0 | Unrelated articles became commercial news; only latest 100 examined | Explicit UAS text filter on full index before paging; full corpus remains selectable; preserve supplied classifications; unmatched is unclassified | Irrelevant newer rows cannot crowd older UAS rows out of first page |
| P0 | Future or malformed dates looked current; reference and publication dates mixed | Flag source dates against publication snapshot clock; valid past dates before future/unknown; reference desks separate | Original date retained; future/malformed samples verified |
| P1 | Ask PIE had large explanatory panels, empty result sections and hashes before searching | One Research entrance; collapsed method/provenance; show result sections after retrieval; advanced search keeps query | Exact record, saved packet, citations, exports and failure behavior retained |
| P1 | Builder started with Antennas and Cost ignored the current build | Visible My build workspace; frame default; cost shares selected IDs and current local state | Parts persist through cost/back; missing/quoted prices never become zero |
| P1 | Tool discovery depended on several incomplete directories | Searchable directory generated from the actual public route inventory | All enabled public routes discoverable except duplicate entrance aliases; no private subroutes |
| P1 | Two unrelated Pipeline Health links | Data status with Dataset coverage and Collection pipeline | Distinct names and unchanged underlying diagnostic views |

## Delivery order

1. Build shared navigation, home pages and directory.
2. Update research presentation and indexed news projection together.
3. Connect current-build cost and correct incomplete totals.
4. Run focused regression suites, an offline production build, and the all-page static audit. Inspect mobile and desktop in a browser where preview access permits.
5. Review the pull request; release the Pages build with its bundled API functions. The News UI requires the new `query.scope` contract and reports an explicit error against an older worker rather than presenting an unfiltered feed.

## Implementation follow-up

Research and implementation details are in [UX_IMPLEMENTATION_RESEARCH_2026-10-03.md](UX_IMPLEMENTATION_RESEARCH_2026-10-03.md).

- Named builds, quantities, versioned storage, legacy share support and Cost continuity are implemented in this branch.
- Guide, Audit, Stack and Wiring now display the current build as read-only context with a return link. Automatic field mapping and assembly records remain separate work.
- The companion Handbook change adopts Research / Build / Learn, compact chapter navigation and task-oriented search starters.
- Editorial relevance sampling and observed usability sessions still require representative labels and real users. No improvement percentage or editorial accuracy is claimed.
- No routes, subscriptions or specialist tools are retired without usage and owner review.

## Release checks

- Verify the Pages deployment includes matching API functions: `functions/api/[[path]].js` imports `workers/index.js`. Check scope echo, pagination and future-date samples on that deployment; no independent worker rollout is required by this repository routing.
- Check 390px mobile and desktop: menu open/close, keyboard focus, directory filter, empty/loading/error states, search/save/restore, and build-cost-return.
- Confirm private paths still require Cloudflare Access and the disabled public DDG entry stays disabled.
- Compare live daily counts and coverage against the pinned publication. An offline build verifies code and local snapshots, not live ingestion health.
- Monitor API errors, navigation dead ends, and failed task reports. Roll back the matched Pages release if core journeys regress.

## Verification

Source and built audits, offline build, Python fixtures, Node regressions and CI browser acceptance are tracked in the implementation research document and draft PR. Browser access to the hosted preview is blocked by automatic approval review at Cloudflare Access; authenticated preview review remains a release gate.

[Route inventory](UX_ROUTE_INVENTORY.csv) lists every mapped route and inspection coverage. Source/generated-output coverage is not a claim that every authenticated workflow has been exercised.

No production deployment or tool retirement is included in this branch.
