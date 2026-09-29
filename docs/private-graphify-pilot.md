# Private relationship evidence and Graphify

The private Supply Web and dossiers read `/private/relationships.json`. A separate
`/private/graphify.json` contains only active, affirmative, source-checked claims
for Graphify traversal. Both come from the exact Ai-Project commit selected by
the private build. No production model calls or graph database are required.
Private sources and generated outputs remain behind the existing access gate;
the public API and KV allowlists are unchanged.

## Private upstream inputs

- `data/ddg_supply_links.json`: curated supplier/component/platform pairs, with
  relationship-level sources, evidence references, roles and integration stages.
- `data/platform_boms.json`: first-party parts, kept separate from shared suppliers.
- `data/private_graphify/graph.json`: typed research assertions in node-link format.
- `data/private_graphify/sources.json`: primary-source observations, paraphrased
  summaries, passage locators, publishers, publication/modification and retrieval dates.
- `data/private_graphify/reviews.json`: content-bound decisions naming the actual reviewer.
- `data/private_graphify/changes.json`: correction log for this research pass.
- Cited research Markdown: exact excerpts, line locations and document SHA256s.

Keep private research, raw extracts and real test exports out of the public
Forge repository. Tests here use fictional entities. A dataset date does not
reverify every row. Legacy C/S/I labels remain visible as prior assessments.

## Extraction is separate from verification

Graphify `graphifyy==0.9.71` was exercised in an isolated environment:

```sh
uv tool install graphifyy==0.9.71
```

Codex-assisted semantic extraction produced the research assertions. Real
Graphify CLI queries exercise the resulting graph; an autonomous extraction
backend or crawler is not configured. Document extraction needs an assistant
or configured model (`graphify extract PATH --backend BACKEND`); code-only AST
extraction does not discover claims in Markdown. Select a bounded corpus and
use an approved provider for private material.

Required candidate fields:

| Field | Meaning |
| --- | --- |
| node `id`, `label`, `kind` | Company, person, platform, component or division; no fuzzy entity merges |
| edge `source`, `target`, `relation` | Explicit directed relationship from the importer’s relation vocabulary |
| `confidence` | EXTRACTED, INFERRED or AMBIGUOUS; extraction method, never a truth score |
| `assertion` | affirmed, disputed or unknown |
| `source_file`, `source_location` | Bounded research Markdown path and exact line range |
| `source_sha256`, `excerpt` | Original document hash and matching passage |
| `evidence_refs` | Primary observation ID plus `claim`, `context` or `correction` attribution |
| `role`, `configuration`, `lifecycle` | Part role, applicable configuration, and announcement/test/availability stage |

Source observations record what was read, not a full-page archived snapshot.
The complete observation participates in the claim fingerprint. Changing a
source interpretation, date, URL, role or note invalidates the relevant review.
A page with no date remains undated. Reposting the same company statement does
not establish independent corroboration. Multiple sources from one publisher
remain visibly one publisher.

## Generate and query

```sh
python tools/private_evidence.py \
  --upstream-dir /path/to/Ai-Project \
  --upstream-ref EXACT_40_CHARACTER_COMMIT \
  --output /private/work/relationships.json \
  --graph-output /private/work/graphify.json --strict
graphify query 'Example Radio' --graph /private/work/graphify.json
```

Use the reviewed export for answers. The raw candidate graph includes unresolved
and superseded research; generic traversal of that graph ignores the review
ledger. The full evidence view preserves those records in its history filter.
Strict validation fails on rejected candidates and expired reviews. Absence of
candidate input preserves the legacy evidence view without silently approving it.

## Record a review

Inspect the primary sources and exact role before recording a decision:

```sh
python tools/review_private_evidence.py \
  --upstream-dir /path/to/Ai-Project --upstream-ref EXACT_40_CHARACTER_COMMIT \
  --record-id 'rel:RECORD_ID' --expected-fingerprint FULL_RECORD_FINGERPRINT \
  --status supported --reviewer 'Actual reviewer' --reviewed-on YYYY-MM-DD \
  --rationale 'The named source supports this specific variant and role.'
```

Statuses include `supported`, `not_supported`, `disputed`, `rejected`, and
`superseded`. Unsupported attribution means the cited evidence fails to support
the claim; it does not prove impossibility. Source-checked support requires a
primary observation explicitly attributed to the claim. The helper refuses a
changed fingerprint or incomplete provenance. Codex research reviews name
Codex and its method; they are not represented as human approvals or independent
hardware inspections. Prior decisions remain in history.

A contact is not an owner; a division is not a separate legal company; a
partnership is not equity or a component BOM. An optional payload is not the
base radio. Conflict detection considers component, role and configuration,
and ignores resolved historical assertions. Unspecified scope remains broad.

## Corrections must survive regeneration

Upstream `retired_links` identifies exact component/platform pairs with reasons
and dates. The upstream component map generator applies those removals **after**
its historical/handbook union so stale inputs cannot restore corrected links.
Later evidence requires explicitly reconsidering the retirement. No fuzzy or
company-wide removals are performed. Source research never automatically rewrites
supplier data; curated corrections are separate repository edits.

## UI and release

The interface offers source support, unresolved gaps, integration stage and
history filters, a priority review queue, all-match browsing, stable record links
and a filtered evidence download. The graph focuses on immediate neighbors;
full evidence stays accessible on mobile. The BOM page displays configuration
scope and suppresses an installed-total estimate for mixed options/test records.

Merge the paired data and Forge changes and deploy the exact tested upstream
revision. Merging Ai-Project main alone does not prove its generated-data branch
contains the research. The release manifest pins both evidence outputs by hash;
the auditor verifies the reviewed graph contains exactly the eligible records.

```sh
python -m pytest tests/test_private_evidence.py tests/test_private_release.py tests/test_pages_build.py
node --test tests/test_private_relationships.cjs
```
