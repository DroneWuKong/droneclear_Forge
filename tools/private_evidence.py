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
RELATIONS = {
    "owns", "acquired", "announced_acquisition_of", "invested_in",
    "partnered_with", "manufactures", "supplies_component", "brand_of",
    "program_contact_for", "formerly_named", "unverified_supply_claim", "backed_by",
}
KINDS = {"company", "person", "platform", "component"}


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


def build_evidence(root, upstream_ref):
    root = Path(root).resolve()
    if not re.fullmatch(r"[0-9a-fA-F]{40}", upstream_ref):
        raise ValueError("An immutable upstream commit is required")
    supply = read_json(root / "data/ddg_supply_links.json", {"suppliers": []})
    graph = read_json(root / GRAPH_PATH, {"nodes": [], "links": []})
    nodes, records, rejected = {}, {}, []

    def node(kind, label):
        if kind not in KINDS or not isinstance(label, str) or not label.strip():
            raise ValueError("Entity requires a supported kind and nonempty label")
        ident = entity_id(kind, label)
        nodes[ident] = {"id": ident, "kind": kind, "label": label.strip()}
        return ident

    def add(row):
        row["id"] = "rel:" + digest({k: row.get(k) for k in (
            "source", "target", "relation", "component", "origin", "source_file", "source_location", "assertion")})[:24]
        row["fingerprint"] = digest(row)
        records[row["id"]] = row

    for supplier in supply.get("suppliers", []):
        sid = node("company", supplier["supplier"])
        for feed in supplier.get("feeds", []):
            specific = bool(feed.get("sources"))
            urls = feed.get("sources") if specific else supplier.get("sources", [])
            evidence = [{"urls": [url], "excerpt": "", "source_date": None}
                        for url in (web_url(u) for u in urls) if url]
            add({"source": sid, "target": node("platform", feed["platform"]),
                 "relation": "supplies_component", "component": supplier.get("component", ""),
                 "subsystem": supplier.get("subsystem", ""), "company": feed.get("company", ""),
                 "origin": "legacy_supply", "assertion": "affirmed",
                 "legacy_confidence": feed.get("confidence", "I"),
                 "review_status": "needs_review", "verified_on": None,
                 "source_file": "data/ddg_supply_links.json",
                 "source_generated": supply.get("meta", {}).get("generated"),
                 "evidence_scope": "relationship" if specific else "supplier",
                 "evidence": evidence, "note": supplier.get("note", ""),
                 "review_gaps": (["Sources are pooled at supplier level; relationship attribution needed"]
                                 if not specific else []) + ["Supporting passage and verification date missing"]})

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
                 "evidence": [evidence], "note": edge.get("note", ""), "review_gaps": gaps,
                 "extractor": graph.get("graph", {}).get("extractor", "unspecified")})
        except (KeyError, TypeError, ValueError) as error:
            rejected.append({"edge_index": number, "reason": str(error)})

    # A review is separate from extraction, bound to all displayed claim/evidence
    # fields. Changes invalidate it; publication time never becomes verified_on.
    reviews = read_json(root / REVIEWS_PATH, {"reviews": []}).get("reviews", [])
    for review in reviews:
        row = records.get(review.get("record_id"))
        if not row:
            continue
        row.setdefault("review_history", []).append(review)
        valid = (review.get("fingerprint") == row["fingerprint"]
                 and review.get("status") in {"supported", "disputed", "rejected", "superseded"}
                 and valid_date(review.get("reviewed_on"))
                 and review.get("reviewer") and review.get("rationale")
                 and not row["review_gaps"])
        row["review_status"] = review["status"] if valid else "stale_review"
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
                                         if {records[ident]["assertion"], row["assertion"]} == {"affirmed", "disputed"}]

    return {"schema_version": 1, "upstream_ref": upstream_ref,
            "supply_source_generated": supply.get("meta", {}).get("generated"),
            "nodes": sorted(nodes.values(), key=lambda n: n["id"]),
            "relationships": sorted(records.values(), key=lambda r: r["id"]),
            "rejected_candidates": rejected,
            "summary": {"supply_links": sum(r["origin"] == "legacy_supply" for r in records.values()),
                        "candidates": sum(r["origin"] == "graphify_candidate" for r in records.values()),
                        "conflicted_records": sum(bool(r["conflicting_record_ids"]) for r in records.values()),
                        "rejected_candidates": len(rejected)}}


def write_evidence(root, upstream_ref, output):
    payload = build_evidence(root, upstream_ref)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream-dir", type=Path, required=True)
    parser.add_argument("--upstream-ref", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = write_evidence(args.upstream_dir, args.upstream_ref, args.output)
    print(json.dumps(payload["summary"]))


if __name__ == "__main__":
    main()
