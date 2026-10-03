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
5. Review the pull request; release the data worker with its matching static site. The News UI requires the new `query.scope` contract and reports an explicit error against an older worker rather than presenting an unfiltered feed.

## Remaining product work after this change

These need separate implementation or user evidence; this branch does not claim to solve them:

- **Handbook repository:** adopt the same three-area navigation and add task-oriented chapter search. This repository links to the existing Handbook; its source is a separate project.
- **Build workspace depth:** unify named/multiple builds, quantities, assembly records and specialist wiring/stack tools only after specifying a versioned shared model. Today only Builder and Cost share the current component list. Existing wiring, guide and audit tools must not claim they automatically consume it.
- **Research relevance:** validate the transparent title/summary filter against a labeled editorial sample. Measure false positives/negatives before adding trained ranking or changing upstream ingestion. A text match is not a verified relevance judgment.
- **Usage validation:** have first-time and returning users perform four tasks: find today's change, research a question with citations, resume a build and inspect its known cost, find an advanced tool. Record completion, wrong turns and time. No usability improvement percentage is claimed without this evidence.
- **Retirement decisions:** review usage and owners before removing routes, data, subscriptions, or specialist functions. Stable links are preserved by this change.

## Release checks

- Deploy worker before or atomically with static UI; verify scope echo, pagination and future-date samples on the deployed API.
- Check 390px mobile and desktop: menu open/close, keyboard focus, directory filter, empty/loading/error states, search/save/restore, and build-cost-return.
- Confirm private paths still require Cloudflare Access and the disabled public DDG entry stays disabled.
- Compare live daily counts and coverage against the pinned publication. An offline build verifies code and local snapshots, not live ingestion health.
- Monitor API errors, navigation dead ends, and failed task reports. Roll back the matched site/worker release if core journeys regress.

## Verification of this branch

- Offline production build: passed, preserving 4,209 component records, 335 model records and 43 categories from local inputs.
- Generated HTML audit: 95 files, 29 datasets, zero blocking findings. One existing warning: the initially empty, hidden Clear dossier button in the private Supply Web page receives its text at runtime.
- Eleven Node test files passed: research retrieval and Worker projection, Builder values, new UX regressions, private access context, existing site polish, public quality surfaces, daily work and data projections.
- Python navigation rewrite and asset checks (five cases) and directory coverage (one case): passed.
- New cases cover filtering before pagination, full-corpus access, source-date flags, metadata preservation, current-build ID continuity, and Cost handling of missing/range/zero values. New tests are included in CI.
- Visual/browser verification: **not completed**. The cloud browser rejects the local preview URL with `ERR_BLOCKED_BY_CLIENT`. Mobile layout and live API/browser interactions remain explicit release gates; no screenshot or usability-test success is claimed.
- [Route inventory](UX_ROUTE_INVENTORY.csv) lists every mapped route, area, discoverability and extent of inspection. The audit covers source and generated output; it does not claim that every tool or authenticated workflow was exercised.

## Concrete follow-up backlog

| Order | Owner role | Work item | Done when |
|---|---|---|---|
| 1 | Frontend/release | Preview this branch with its matching data worker | Four core journeys work at 390px and desktop; keyboard menu and focus pass |
| 2 | Frontend | Carry shared task navigation into the Handbook repository | Research/Build/Learn labels and destinations match; existing chapter anchors work |
| 3 | Product + frontend | Specify and implement versioned named builds and quantities | Current build migrates without loss; quantity edits agree across parts, cost and export |
| 4 | Frontend | Integrate remaining build tools one at a time | Each tool declares what build fields it reads/writes and preserves the return path |
| 5 | Research/data | Label a representative sample of relevant and irrelevant news | Report precision/recall and date errors; adjust the documented filter based on evidence |
| 6 | Product | Observe new and returning users on the four core tasks | Record wrong turns and completion; prioritize remaining friction from observations |

No production deployment or tool retirement is included in this branch.
