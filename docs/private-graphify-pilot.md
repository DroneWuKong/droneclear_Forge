# Private relationship evidence and Graphify pilot

The private Supply Web and dossier viewer share `/private/relationships.json`.
`tools/private_evidence.py` builds it deterministically from the exact Ai-Project
commit already selected by the private export. The build performs no model calls.
The public data API, KV publication allowlist and access gate are unchanged.

## Inputs in the private Ai-Project repository

- `data/ddg_supply_links.json`: existing supplier/component/platform records.
- `data/private_graphify/graph.json`: optional Graphify node-link candidates.
- `data/private_graphify/reviews.json`: optional append-only review decisions.
- The `research/*.md` / `research/profiles/*.md` documents cited by candidates.

Keep these inputs, raw excerpts and generated graphs out of the public Forge
repository. The only committed test corpus here uses fictional entities.
The existing June supply snapshot remains dated June; build time is never an
evidence verification date. Legacy C/S/I values remain visible as prior
assessments, with missing per-relationship evidence clearly identified.

## Extraction and import

Graphify was exercised with `graphifyy==0.9.71`. Install it in an isolated tool
environment, not as a production Pages dependency:

```sh
uv tool install graphifyy==0.9.71
```

Use `/graphify` with a coding assistant over a deliberately selected dossier
corpus, or `graphify extract PATH --backend BACKEND` with an explicitly configured
model backend. Document extraction needs the assistant/model; code-only AST
extraction cannot discover ownership claims in Markdown. Do not run the whole
private repository through an unapproved provider. This initial six-claim pilot
uses Codex-assisted semantic extraction into Graphify's node-link format and
was queried with the real Graphify CLI; it is not an autonomous web crawl.

Before placing the candidate graph at the private input path, retain:

| Field | Required meaning |
| --- | --- |
| node `id`, `label`, `kind` | Stable identity; kind is company, person, platform or component |
| edge `source`, `target`, `relation` | Directed, explicitly typed relationship; see `RELATIONS` in the importer |
| edge `confidence` | Graphify EXTRACTED, INFERRED or AMBIGUOUS; never a truth score |
| edge `assertion` | affirmed, disputed or unknown |
| edge `source_file`, `source_location` | Repository-relative research Markdown and exact `L12` / `L12-L14` range |
| edge `source_sha256`, `excerpt` | SHA256 of original document bytes and verbatim supporting passage |
| edge `source_urls`, `source_date`, `note` | Source chain, actual document date if known, and scope/uncertainty |

The importer accepts either `links` or `edges`, preserves multiple relation
types, and rejects unsupported kinds/relations, absent source files and path
traversal. A changed document hash or nonmatching passage is shown as a review
gap. Supplier-level URLs are never silently reclassified as edge evidence.
Entity matching normalizes only case and whitespace; no fuzzy merge of brands,
parents, contacts or subsidiaries. A contact is not an owner. A manufacturing
partnership is not a component BOM. A past acquisition is not a current cap table.

For a dispute, prefer an explicit raw relation such as
`unverified_supply_claim` so even Graphify's generic path output cannot turn a
negative/uncertain passage into an affirmative supplier assertion. Cross-source
model resolution must be INFERRED and explain the limitation in `note`.

Validate against a pinned private checkout:

```sh
python tools/private_evidence.py \
  --upstream-dir /path/to/Ai-Project \
  --upstream-ref EXACT_40_CHARACTER_COMMIT \
  --output /private/work/relationships.json
graphify query 'Example Radio' --graph /path/to/Ai-Project/data/private_graphify/graph.json
```

Review `rejected_candidates`, missing evidence and conflicting assertions.
Publication does not amend `ddg_supply_links.json` or component/platform maps.
Both views carry their own status. An optional `all` view compares conflicting
legacy and candidate records without changing either record.

## Reviews and history

`reviews.json` contains a `reviews` array of chronological decisions. Each entry
has `record_id`, `fingerprint` (from the generated record), `status` (supported,
disputed, rejected or superseded), `reviewed_on` (ISO date), `reviewer`, and
`rationale`. Only an explicit decision matching the complete claim/evidence
fingerprint and having no evidence gaps can set a reviewed status. New extraction
cannot forge these fields. A changed document or claim expires the review;
prior decisions remain in the record history. Review timestamps must reflect the
actual review. Source publication dates and site release timestamps stay separate.

The initial private pilot has no approvals. A later human/research review should
compare original sources before recording support. Removing a candidate from
the input removes it from the view; use a superseded/rejected review to retain
it as history instead. The pinned Git history preserves earlier releases.

## Deployment and checks

Merge the companion private data PR and this Forge PR, then use the existing
pinned Pages workflow. Ensure the resolved upstream data commit contains
`data/private_graphify/graph.json`; do not assume merging main updates a generated
data branch. If necessary select an exact tested `AI_PROJECT_REF`. The private
release manifest records the evidence output hash and counts. A release without
candidate input still displays legacy evidence with explicit gaps.

```sh
python -m pytest tests/test_private_evidence.py tests/test_private_release.py tests/test_pages_build.py
node --test tests/test_private_relationships.cjs
```

The page defaults to a selected entity's immediate neighbors, caps the drawing
at 12 neighbors (six on mobile), and keeps the complete filtered evidence list. Search, status
filters, dossier links and keyboard/touch navigation work without a graph
database or external visualization service.
