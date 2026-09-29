"""Project private supply records and Graphify proposals without promoting claims.

No network or LLM calls. Inputs and generated output belong in the private
upstream repository or gated build output, never in the public source tree.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date
from pathlib import Path
import re
from urllib.parse import urlsplit

GRAPH_PATH = "data/private_graphify/graph.json"
REVIEWS_PATH = "data/private_graphify/reviews.json"
SOURCES_PATH = "data/private_graphify/sources.json"
INACTIVE = {"rejected", "superseded", "not_supported"}
RELATIONS = {
    "owns", "acquired", "announced_acquisition_of", "invested_in",
    "partnered_with", "manufactures", "supplies_component", "brand_of",
    "program_contact_for", "formerly_named", "unverified_supply_claim", "backed_by",
    "division_of", "beneficial_owner_of",
}
KINDS = {"company", "person", "platform", "component", "division"}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def entity_id(kind, label):
    # Only case/whitespace normalization. Never merge brands, parents or aliases
    # by substring/fuzzy match (earlier dossier corrections rely on this).
    return kind + ":" + digest(" ".join(label.casefold().split()))[:20]


def web_url(value):
    if not isinstance(value, str):
        return None
    try:
        url = urlsplit(value)
        return value if url.scheme in {"http", "https"} and url.hostname and not url.username else None
    except ValueError:
        return None


def read_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else default


def valid_date(value):
    try:
        return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
    except ValueError:
        return False


def source_evidence(edge, root):
    """Validate a Graphify excerpt against its bounded, content-pinned dossier."""
    source = edge.get("source_file", "")
    path = root / source
    if (not isinstance(source, str) or Path(source).is_absolute()
            or ".." in Path(source).parts or not source.startswith("research/")
            or not path.resolve().is_relative_to((root / "research").resolve())
            or path.suffix != ".md" or not path.is_file()):
        raise ValueError("source_file must identify an existing research Markdown file")
    content = path.read_text(encoding="utf-8")
    actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    excerpt = edge.get("excerpt", "")
    location = edge.get("source_location", "")
    match = re.fullmatch(r"L([1-9]\d*)(?:-L?([1-9]\d*))?", location)
    gaps = []
    if edge.get("source_sha256") != actual_hash:
        gaps.append("Source fingerprint missing or changed; re-extract and review")
    passage_matches = False
    if match and isinstance(excerpt, str) and excerpt.strip():
        start, end = int(match[1]), int(match[2] or match[1])
        lines = content.splitlines()
        passage_matches = start <= end <= len(lines) and excerpt in "\n".join(lines[start - 1:end])
    if not passage_matches:
        gaps.append("Excerpt does not match the cited line range")
    urls = [u for u in (web_url(x) for x in edge.get("source_urls", [])) if u]
    evidence = {
        "source_path": source, "source_location": location,
        "source_sha256": actual_hash, "extracted_source_sha256": edge.get("source_sha256"),
        "excerpt": excerpt, "passage_matches": passage_matches,
        "source_date": edge.get("source_date"), "urls": urls,
        "dossier_slug": path.stem,
    }
    return evidence, gaps



def primary_evidence(refs, sources):
    """Resolve curated source observations; retrieval is not independent verification.

    The entire observation is included in the relationship fingerprint. Registry
    edits expire reviews even if the URL and research-note excerpt stay unchanged.
    """
    evidence, gaps = [], []
    for ref in refs:
        source = sources.get(ref.get("source_id"))
        if not source:
            gaps.append("Referenced source observation is missing")
            continue
        url = web_url(source.get("url"))
        if (not url or not source.get("publisher") or not source.get("title")
                or not source.get("summary") or not source.get("locator")
                or not valid_date(source.get("retrieved_on"))
                or source.get("kind") not in {"manufacturer", "government", "regulatory_filing"}
                or (source.get("published_on") is not None and not valid_date(source["published_on"]))
                or ref.get("supports") not in {"claim", "context", "correction"}):
            gaps.append("Source observation has incomplete provenance")
            continue
        evidence.append({**source, "urls": [url], "supports": ref["supports"],
                         "observation_sha256": digest(source), "evidence_type": "primary_source"})
    return evidence, gaps


def scopes_overlap(a, b):
    # Different roles (base radio / optional relay) are not contradictions. An
    # unspecified role is intentionally broad and still reaches the review queue.
    for field in ("role", "configuration"):
        av, bv = a.get(field), b.get(field)
        if av and bv and av != bv:
            return False
    ac, bc = a.get("component"), b.get("component")
    return not ac or not bc or ac.casefold() == bc.casefold()


def build_evidence(root, upstream_ref):
    root = Path(root).resolve()
    if not re.fullmatch(r"[0-9a-fA-F]{40}", upstream_ref):
        raise ValueError("An immutable upstream commit is required")
    supply = read_json(root / "data/ddg_supply_links.json", {"suppliers": []})
    graph = read_json(root / GRAPH_PATH, {"nodes": [], "links": []})
    source_list = read_json(root / SOURCES_PATH, {"sources": []}).get("sources", [])
    sources = {s["id"]: s for s in source_list}
    if len(sources) != len(source_list):
        raise ValueError("Duplicate source observation ID")
    nodes, records, rejected = {}, {}, []

    def node(kind, label):
        if kind not in KINDS or not isinstance(label, str) or not label.strip():
            raise ValueError("Entity requires a supported kind and nonempty label")
        ident = entity_id(kind, label)
        nodes[ident] = {"id": ident, "kind": kind, "label": label.strip()}
        return ident

    def add(row):
        row["id"] = "rel:" + digest({k: row.get(k) for k in (
            "source", "target", "relation", "component", "origin", "source_file", "source_location", "assertion", "role", "configuration")})[:24]
        row["fingerprint"] = digest(row)
        if row["id"] in records:
            raise ValueError("Duplicate relationship identity; consolidate evidence explicitly")
        records[row["id"]] = row

    for supplier in supply.get("suppliers", []):
        sid = node("company", supplier["supplier"])
        for feed in supplier.get("feeds", []):
            specific = bool(feed.get("sources"))
            urls = feed.get("sources") if specific else supplier.get("sources", [])
            evidence, gaps = primary_evidence(feed.get("evidence_refs", []), sources)
            if not evidence:
                evidence = [{"urls": [url], "excerpt": "", "source_date": None}
                            for url in (web_url(u) for u in urls) if url]
                gaps += (["Sources are pooled at supplier level; relationship attribution needed"]
                         if not specific else []) + ["Supporting passage and verification date missing"]
            add({"source": sid, "target": node("platform", feed["platform"]),
                 "relation": "supplies_component", "component": supplier.get("component", ""),
                 "subsystem": supplier.get("subsystem", ""), "company": feed.get("company", ""),
                 "origin": "legacy_supply", "assertion": "affirmed",
                 "legacy_confidence": feed.get("confidence", "I"),
                 "review_status": "needs_review", "verified_on": None,
                 "source_file": "data/ddg_supply_links.json",
                 "source_generated": supply.get("meta", {}).get("generated"),
                 "evidence_scope": "relationship" if specific or feed.get("evidence_refs") else "supplier",
                 "evidence": evidence, "note": feed.get("note", supplier.get("note", "")),
                 "role": feed.get("role", ""), "configuration": feed.get("configuration", ""),
                 "lifecycle": feed.get("lifecycle", "unspecified"),
                 "review_gaps": gaps})

    raw_nodes = {}
    for n in graph.get("nodes", []):
        if n.get("id") in raw_nodes:
            raise ValueError("Duplicate Graphify node ID")
        raw_nodes[n.get("id")] = n
    raw_edges = graph.get("links", graph.get("edges", []))
    for number, edge in enumerate(raw_edges):
        try:
            source, target = raw_nodes[edge["source"]], raw_nodes[edge["target"]]
            if edge.get("relation") not in RELATIONS:
                raise ValueError("Unsupported relationship; map explicitly before importing")
            assertion = edge.get("assertion", "affirmed")
            if assertion not in {"affirmed", "disputed", "unknown"}:
                raise ValueError("Invalid assertion polarity")
            evidence, gaps = source_evidence(edge, root)
            primary, primary_gaps = primary_evidence(edge.get("evidence_refs", []), sources)
            gaps.extend(primary_gaps)
            confidence = edge.get("confidence")
            if confidence not in {"EXTRACTED", "INFERRED", "AMBIGUOUS"}:
                raise ValueError("Missing Graphify extraction classification")
            add({"source": node(source.get("kind"), source.get("label")),
                 "target": node(target.get("kind"), target.get("label")),
                 "relation": edge["relation"], "component": edge.get("component", ""),
                 "origin": "graphify_candidate", "assertion": assertion,
                 "extraction": confidence, "review_status": "needs_review", "verified_on": None,
                 "source_file": evidence["source_path"], "source_location": evidence["source_location"],
                 "evidence_scope": "relationship",
                 "evidence": [evidence] + primary, "note": edge.get("note", ""), "review_gaps": gaps,
                 "role": edge.get("role", ""), "configuration": edge.get("configuration", ""),
                 "lifecycle": edge.get("lifecycle", "unspecified"),
                 "extractor": graph.get("graph", {}).get("extractor", "unspecified")})
        except (KeyError, TypeError, ValueError) as error:
            rejected.append({"edge_index": number, "reason": str(error)})

    # A review is separate from extraction, bound to all displayed claim/evidence
    # fields. Changes invalidate it; publication time never becomes verified_on.
    reviews = read_json(root / REVIEWS_PATH, {"reviews": []}).get("reviews", [])
    for review in sorted(reviews, key=lambda r: (r.get("reviewed_on", ""), r.get("sequence", 0))):
        row = records.get(review.get("record_id"))
        if not row:
            continue
        row.setdefault("review_history", []).append(review)
        valid = (review.get("fingerprint") == row["fingerprint"]
                 and review.get("status") in {"supported", "disputed", "rejected", "superseded", "not_supported"}
                 and valid_date(review.get("reviewed_on"))
                 and review.get("reviewer") and review.get("rationale")
                 and not row["review_gaps"])
        if review.get("review_type") == "source_checked" and review.get("status") == "supported":
            valid = valid and any(e.get("evidence_type") == "primary_source" and e["supports"] == "claim"
                                  for e in row["evidence"])
        row["review_status"] = review["status"] if valid else "stale_review"
        row["review_type"] = review.get("review_type", "analyst_review") if valid else None
        row["verified_on"] = review["reviewed_on"] if valid else None

    # Same endpoints/relation, opposing assertions: expose a conflict for review.
    # Do not decide which document wins, or transfer ownership to a BOM.
    for row in records.values():
        family = lambda r: "supplies_component" if r["relation"] == "unverified_supply_claim" else r["relation"]
        row["related_record_ids"] = [other["id"] for other in records.values()
                                     if other["id"] != row["id"]
                                     and (other["source"], other["target"], family(other))
                                     == (row["source"], row["target"], family(row))]
        row["conflicting_record_ids"] = [ident for ident in row["related_record_ids"]
                                         if {records[ident]["assertion"], row["assertion"]} == {"affirmed", "disputed"}
                                         and row["review_status"] not in INACTIVE
                                         and records[ident]["review_status"] not in INACTIVE
                                         and scopes_overlap(row, records[ident])]
        row["active"] = row["review_status"] not in INACTIVE
        row["source_count"] = len({e["url"] for e in row["evidence"] if e.get("evidence_type") == "primary_source"})
        row["source_publishers"] = sorted({e["publisher"] for e in row["evidence"] if e.get("evidence_type") == "primary_source"})
        row["quality_flags"] = list(row["review_gaps"])
        if row["active"] and row["review_status"] in {"needs_review", "stale_review"}:
            row["quality_flags"].append("No current review for this claim")
        if row["source_count"] == 1:
            row["quality_flags"].append("One primary source; independent corroboration not established")
        if row.get("legacy_confidence") == "C":
            if row["review_status"] != "supported":
                row["quality_flags"].append("Legacy confirmed label has not passed the evidence review")
        row["review_priority"] = ("resolved" if not row["active"] else
                                  "high" if row["conflicting_record_ids"] or row["review_status"] == "stale_review"
                                  or (row.get("legacy_confidence") == "C" and row["review_status"] != "supported") else
                                  "normal" if row["review_status"] != "supported" else "follow_up")

    return {"schema_version": 1,
            "research_checked_on": max((s.get("retrieved_on", "") for s in source_list), default=None),
            "source_observations": source_list, "upstream_ref": upstream_ref,
            "supply_source_generated": supply.get("meta", {}).get("generated"),
            "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
            "relationships": sorted(records.values(), key=lambda r: r["id"]),
            "rejected_candidates": rejected,
            "summary": {"supply_links": sum(r["origin"] == "legacy_supply" for r in records.values()),
                        "candidates": sum(r["origin"] == "graphify_candidate" for r in records.values()),
                        "conflicted_records": sum(bool(r["conflicting_record_ids"]) for r in records.values()),
                        "rejected_candidates": len(rejected),
                        "supported": sum(r["review_status"] == "supported" for r in records.values()),
                        "primary_sources": len({e["url"] for r in records.values() for e in r["evidence"] if e.get("evidence_type") == "primary_source"}),
                        "needs_review": sum(r["active"] and r["review_status"] != "supported" for r in records.values()),
                        "high_priority": sum(r["review_priority"] == "high" for r in records.values()),
                        "resolved": sum(not r["active"] for r in records.values())}}


def reviewed_graph(payload):
    """Safe Graphify query corpus: active, affirmative, source-checked claims only.

    Raw candidate traversal ignores our review ledger; never use that raw graph
    as an answer corpus. The full evidence export keeps unresolved/history rows.
    """
    rows = [r for r in payload['relationships'] if r['active'] and r['assertion'] == 'affirmed'
            and r['review_status'] == 'supported' and r.get('review_type') == 'source_checked']
    used = {r[k] for r in rows for k in ('source', 'target')}
    return {'directed': True, 'multigraph': True,
            'graph': {'upstream_ref': payload['upstream_ref'], 'scope': 'Source-checked affirmative claims only; document support, not independent certification'},
            'nodes': [{**n, 'file_type': 'document'} for n in payload['nodes'] if n['id'] in used],
            'links': [{**r, 'confidence': r.get('extraction', 'EXTRACTED'),
                       'context': ' · '.join(x for x in [r.get('role'), r.get('configuration'), r.get('lifecycle')] if x)} for r in rows]}


def write_evidence(root, upstream_ref, output, graph_output=None):
    payload = build_evidence(root, upstream_ref)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if graph_output is not None:
        graph_output = Path(graph_output)
        graph_output.parent.mkdir(parents=True, exist_ok=True)
        graph_output.write_text(json.dumps(reviewed_graph(payload), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-dir", type=Path, required=True)
    parser.add_argument("--upstream-ref", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--graph-output", type=Path, help="Optional source-checked Graphify query corpus")
    parser.add_argument("--strict", action="store_true", help="Fail on rejected candidates or stale/incomplete reviewed claims")
    args = parser.parse_args()
    payload = write_evidence(args.upstream_dir, args.upstream_ref, args.output, args.graph_output)
    print(json.dumps(payload["summary"]))
    if args.strict and (payload["rejected_candidates"] or any(r["review_status"] == "stale_review" for r in payload["relationships"])):
        raise SystemExit("Private evidence validation failed; repair rejected candidates or stale reviews")


if __name__ == "__main__":
    main()
