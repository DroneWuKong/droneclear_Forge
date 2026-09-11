# Patterns daily and research workflows

The primary entry point is `/patterns-home/`. The daily workspace also appears
on `/brief/`, ahead of the generated narrative. Research remains in the existing
Patterns application at `/ask-pie/`, `/pie-search/`, and `/intel/`.

## Daily review

`GET /api/data?type=daily_changes` returns a bounded projection of canonical PIE
flags. `q`, `state`, `record`, and `limit` select records; the limit defaults to 10
and cannot exceed 50. Exact record lookups fail visibly on missing or ambiguous
identities. The query, change filter, and selected record survive URL navigation.

The first observation establishes a baseline. Subsequent comparisons use a
versioned fingerprint of the claim and evidence, excluding collection timestamps
and URL tracking parameters. Disappearance means **not observed**, not resolved.
Resolution and contradiction require an explicit review bound to the exact claim
and evidence. An available collection is not proof of complete source coverage.

The `daily-navigation-v1` rank sorts material changes first, then UAS relevance,
attached citations, source recency, and indexed severity. Source dates older than
a year reduce background priority. This is a navigation rule, not a confidence
score. Procurement is labeled an opportunity lead only with UAS relevance, an
attached citation, and a source date within 90 days; the terms still need review.
Historical and undated records remain accessible through search and exact links.

The evidence panel shows the recorded claim, change reason, citations, unknown
dates, and review status. It links to the exact signal, topic research, and any
explicitly attached Forge component or platform. Export retains the applied
query, collection metadata, record identity, and evidence. Followed topics and
saved packets live in the current browser; they are not account synchronization
or notification subscriptions.

## Reproducible research

The static build creates `research_index.json` from public, allowlisted inputs.
The Worker searches that index and returns bounded summaries, rather than
shipping every article body on initial page load. Article detail is loaded only
for an exact namespaced record key. Ask PIE and Search share the same retrieval
module. Evidence exports include all returned citations, input hashes, and query
metadata. Publication time never substitutes for a source publication date.

`publication_inputs.json`, the research index input manifest, and the build
manifest identify source revisions, selected bytes, missing inputs, and retained
fallbacks. Check their availability fields before treating a build as coherent.
Generated time is distinct from evidence recency and source independence.

## Forecast accountability

`/forecast-accountability/` exposes the read-only review queue, immutable issuance
criteria, due dates, owner/state, cohort counts, and same-question baselines.
Legacy predictions stay visible and unrated. Only eligible evidence-bound v2
reviews can count toward forecast evaluation. Agreement between model providers
does not establish independent corroboration or justify a probability boost.

The unchanged data-quality score is separate from these interface improvements.
Software checks cannot establish forecast skill, analyst task success, or a 90+
score. Those require genuine future outcomes and documented review evidence.
