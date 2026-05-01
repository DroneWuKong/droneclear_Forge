#!/usr/bin/env python3
"""
generate_flags_rss.py
Generates an RSS 2.0 feed from DroneClear Patterns flags.json
Output: DroneClear Components Visualizer/static/flags.xml
"""

import json
import os
from datetime import datetime, timezone
from xml.etree.ElementTree import Element, SubElement, ElementTree, indent
from pathlib import Path

BASE_DIR = Path(__file__).parent
FLAGS_PATH = BASE_DIR / "DroneClear Components Visualizer" / "static" / "data" / "flags.json"
OUTPUT_PATH = BASE_DIR / "DroneClear Components Visualizer" / "static" / "flags.xml"

SITE_URL = "https://uas-patterns.com"
FEED_TITLE = "DroneClear Patterns — Intel Flags"
FEED_DESC = "Real-time intelligence flags from the DroneClear PIE pipeline: diversion risks, supply constraints, grayzone activity, procurement signals, and correlation alerts."
FEED_LINK = f"{SITE_URL}/patterns/"

SEVERITY_EMOJI = {"critical": "🔴", "warning": "🟡", "info": "🔵"}
FLAG_TYPE_LABEL = {
    "diversion_risk":    "Diversion Risk",
    "supply_constraint": "Supply Constraint",
    "grayzone":          "Grayzone",
    "grayzone_xref":     "Grayzone Cross-Ref",
    "contract_signal":   "Contract Signal",
    "price_anomaly":     "Price Anomaly",
    "correlation":       "Correlation",
    "procurement_spike": "Procurement Spike",
}


def rfc822(ts_str: str) -> str:
    """Convert ISO timestamp to RFC 822 for RSS pubDate."""
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    return dt.strftime("%a, %d %b %Y %H:%M:%S +0000")


def build_description(flag: dict) -> str:
    """Build a rich HTML description block for the RSS item."""
    sev = flag.get("severity", "info")
    emoji = SEVERITY_EMOJI.get(sev, "⚪")
    ft = FLAG_TYPE_LABEL.get(flag.get("flag_type", ""), flag.get("flag_type", ""))
    detail = flag.get("detail", "")
    prediction = flag.get("prediction", "")
    confidence = flag.get("confidence")
    sources = flag.get("sources", [])

    parts = [f"<p><strong>{emoji} {sev.upper()} — {ft}</strong></p>"]
    if detail:
        parts.append(f"<p>{detail}</p>")
    if prediction:
        parts.append(f"<p><em>Prediction:</em> {prediction}</p>")
    if confidence is not None:
        parts.append(f"<p><em>Confidence:</em> {confidence:.0%}</p>")
    if sources:
        src_links = ", ".join(
            f'<a href="{s["url"]}">{s["name"]}</a>' if s.get("url") else s.get("name", "")
            for s in sources
        )
        parts.append(f"<p><em>Sources:</em> {src_links}</p>")
    return "".join(parts)


def generate_rss(flags: list) -> ElementTree:
    # Sort newest first by timestamp
    flags_sorted = sorted(flags, key=lambda f: f.get("timestamp", ""), reverse=True)

    rss = Element("rss", version="2.0")
    rss.set("xmlns:atom", "http://www.w3.org/2005/Atom")
    channel = SubElement(rss, "channel")

    SubElement(channel, "title").text = FEED_TITLE
    SubElement(channel, "link").text = FEED_LINK
    SubElement(channel, "description").text = FEED_DESC
    SubElement(channel, "language").text = "en-us"
    SubElement(channel, "lastBuildDate").text = rfc822(datetime.now(timezone.utc).isoformat())
    atom_link = SubElement(channel, "atom:link")
    atom_link.set("href", f"{SITE_URL}/flags.xml")
    atom_link.set("rel", "self")
    atom_link.set("type", "application/rss+xml")

    for flag in flags_sorted:
        item = SubElement(channel, "item")

        sev = flag.get("severity", "info")
        emoji = SEVERITY_EMOJI.get(sev, "⚪")
        title = f"{emoji} {flag.get('title', 'Untitled Flag')}"
        SubElement(item, "title").text = title

        # Link: deep-link to patterns page with flag id anchor if possible
        flag_id = flag.get("id", "")
        link = f"{FEED_LINK}#{flag_id}" if flag_id else FEED_LINK
        SubElement(item, "link").text = link

        desc = SubElement(item, "description")
        desc.text = build_description(flag)

        SubElement(item, "pubDate").text = rfc822(flag.get("timestamp", ""))
        SubElement(item, "guid", isPermaLink="false").text = flag_id or title

        ft = FLAG_TYPE_LABEL.get(flag.get("flag_type", ""), flag.get("flag_type", "Unknown"))
        SubElement(item, "category").text = ft
        SubElement(item, "category").text = sev.capitalize()

    return ElementTree(rss)


def main():
    flags = json.loads(FLAGS_PATH.read_text())
    print(f"Loaded {len(flags)} flags from {FLAGS_PATH}")

    tree = generate_rss(flags)
    indent(tree, space="  ")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tree.write(str(OUTPUT_PATH), encoding="utf-8", xml_declaration=True)
    print(f"Written RSS feed → {OUTPUT_PATH}")
    print(f"  Items: {len(flags)}")


if __name__ == "__main__":
    main()
