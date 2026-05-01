#!/usr/bin/env python3
"""
generate_brief_rss.py
Generates an RSS 2.0 feed from pie_brief.json + pie_brief_history.json.
Each brief generation becomes one RSS item — a full intel digest.

Output: DroneClear Components Visualizer/static/brief.xml
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, ElementTree, indent

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "DroneClear Components Visualizer" / "static"

BRIEF_PATH   = STATIC_DIR / "pie_brief.json"
HISTORY_PATH = STATIC_DIR / "pie_brief_history.json"
OUTPUT_PATH  = STATIC_DIR / "brief.xml"

SITE_URL    = "https://uas-patterns.com"
FEED_TITLE  = "DroneClear Patterns — Daily Intel Brief"
FEED_DESC   = (
    "Daily UAS intelligence brief from the DroneClear PIE pipeline: "
    "gray zone entities, supply chain signals, procurement predictions, "
    "and actionable watch items for defense and public safety operators."
)
FEED_LINK   = f"{SITE_URL}/patterns/"
FEED_XML    = f"{SITE_URL}/brief.xml"


def rfc822(ts_str: str) -> str:
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    except Exception:
        dt = datetime.now(timezone.utc)
    return dt.strftime("%a, %d %b %Y %H:%M:%S +0000")


def iso_date(ts_str: str) -> str:
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.strftime("%B %-d, %Y")
    except Exception:
        return ts_str[:10]


def brief_to_html(brief: dict) -> str:
    parts = []

    # ── Signal summary bar ──────────────────────────────────────────────────
    sig = brief.get("signal_summary", {})
    if sig:
        total   = sig.get("total_flags", 0)
        crit    = sig.get("critical", 0)
        warn    = sig.get("warning", 0)
        new_    = sig.get("new_today", 0)
        concern = sig.get("top_concern", "")
        parts.append(
            f"<p><strong>Signal Summary:</strong> "
            f"{total} active flags &mdash; "
            f"🔴 {crit} critical &nbsp;|&nbsp; 🟡 {warn} warning"
            + (f" &nbsp;|&nbsp; {new_} new today" if new_ else "")
            + "</p>"
        )
        if concern:
            parts.append(f"<p><em>Top concern:</em> {concern}</p>")
        parts.append("<hr/>")

    # ── Lead story ──────────────────────────────────────────────────────────
    ls = brief.get("lead_story")
    if ls:
        parts.append(f"<h2>Lead Story</h2>")
        parts.append(f"<h3>{ls.get('title', '')}</h3>")
        body = ls.get("body", "")
        if body:
            parts.append(f"<p>{body}</p>")
        sources = ls.get("sources", [])
        if sources:
            links = ", ".join(
                f'<a href="{s["url"]}">{s["name"]}</a>' if s.get("url") else s.get("name", "")
                for s in sources
            )
            parts.append(f"<p><em>Sources:</em> {links}</p>")
        parts.append("<hr/>")

    # ── Gray zone ───────────────────────────────────────────────────────────
    gz = brief.get("gray_zone", [])
    if gz:
        parts.append(f"<h2>Gray Zone Entities ({len(gz)})</h2>")
        for item in gz:
            entity = item.get("entity", "Unknown")
            parts.append(f"<h3>🔴 {entity}</h3>")
            if item.get("status"):
                parts.append(f"<p><strong>Status:</strong> {item['status']}</p>")
            if item.get("development"):
                parts.append(f"<p><strong>Development:</strong> {item['development']}</p>")
            if item.get("buyer_exposure"):
                parts.append(f"<p><strong>Buyer Exposure:</strong> {item['buyer_exposure']}</p>")
            if item.get("action"):
                parts.append(f"<p><strong>Action:</strong> {item['action']}</p>")
            sources = item.get("sources", [])
            if sources:
                links = ", ".join(
                    f'<a href="{s["url"]}">{s["name"]}</a>' if s.get("url") else s.get("name", "")
                    for s in sources
                )
                parts.append(f"<p><em>Sources:</em> {links}</p>")
        parts.append("<hr/>")

    # ── Supply chain ────────────────────────────────────────────────────────
    sc = brief.get("supply_chain", [])
    if sc:
        parts.append(f"<h2>Supply Chain Signals ({len(sc)})</h2>")
        for item in sc:
            comp = item.get("component", "Unknown component")
            parts.append(f"<h3>🟡 {comp}</h3>")
            if item.get("signal"):
                parts.append(f"<p><strong>Signal:</strong> {item['signal']}</p>")
            if item.get("window"):
                parts.append(f"<p><strong>Window:</strong> {item['window']}</p>")
            if item.get("action"):
                parts.append(f"<p><strong>Action:</strong> {item['action']}</p>")
        parts.append("<hr/>")

    # ── Predictions ─────────────────────────────────────────────────────────
    preds = brief.get("predictions", [])
    if preds:
        parts.append(f"<h2>Predictions ({len(preds)})</h2>")
        for p in preds:
            prob = p.get("probability", 0)
            tf   = p.get("timeframe", "")
            evt  = p.get("event", "")
            hedge = p.get("hedge", "")
            pct  = f"{prob:.0%}"
            parts.append(f"<p><strong>{pct} &mdash; {tf}:</strong> {evt}</p>")
            if hedge:
                parts.append(f"<p><em>Hedge:</em> {hedge}</p>")
        parts.append("<hr/>")

    # ── Watch list ──────────────────────────────────────────────────────────
    wl = brief.get("watch_list", [])
    if wl:
        parts.append(f"<h2>Watch List ({len(wl)})</h2>")
        for item in wl:
            parts.append(f"<p><strong>⚠️ {item.get('item', '')}</strong></p>")
            if item.get("why"):
                parts.append(f"<p>{item['why']}</p>")
            if item.get("trigger"):
                parts.append(f"<p><em>Trigger:</em> {item['trigger']}</p>")

    return "".join(parts)


def make_item(brief: dict, channel: Element) -> None:
    ts     = brief.get("generated_at") or brief.get("date", "")
    date_label = iso_date(ts)
    headline   = brief.get("headline", f"DroneClear Intel Brief — {date_label}")
    sig  = brief.get("signal_summary", {})
    crit = sig.get("critical", 0)
    warn = sig.get("warning", 0)

    title = f"[PIE] {date_label} — {headline[:120]}"

    item = SubElement(channel, "item")
    SubElement(item, "title").text = title
    SubElement(item, "link").text  = FEED_LINK
    SubElement(item, "pubDate").text = rfc822(ts)
    SubElement(item, "guid", isPermaLink="false").text = f"pie-brief-{ts[:10]}"
    SubElement(item, "category").text = "Intel Brief"
    if crit:
        SubElement(item, "category").text = "Critical Flags"

    desc = SubElement(item, "description")
    desc.text = brief_to_html(brief)


def main():
    brief   = json.loads(BRIEF_PATH.read_text())
    history = json.loads(HISTORY_PATH.read_text()) if HISTORY_PATH.exists() else []

    # Build ordered list: history (oldest first) + current brief
    briefs = list(history)
    current_date = (brief.get("generated_at") or brief.get("date", ""))[:10]
    if not any((b.get("generated_at") or b.get("date",""))[:10] == current_date for b in briefs):
        briefs.append(brief)
    briefs.sort(key=lambda b: b.get("generated_at") or b.get("date",""), reverse=True)

    rss     = Element("rss", version="2.0")
    rss.set("xmlns:atom", "http://www.w3.org/2005/Atom")
    channel = SubElement(rss, "channel")

    SubElement(channel, "title").text       = FEED_TITLE
    SubElement(channel, "link").text        = FEED_LINK
    SubElement(channel, "description").text = FEED_DESC
    SubElement(channel, "language").text    = "en-us"
    SubElement(channel, "lastBuildDate").text = rfc822(datetime.now(timezone.utc).isoformat())
    atom_link = SubElement(channel, "atom:link")
    atom_link.set("href", FEED_XML)
    atom_link.set("rel", "self")
    atom_link.set("type", "application/rss+xml")

    for b in briefs:
        make_item(b, channel)

    tree = ElementTree(rss)
    indent(tree, space="  ")
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tree.write(str(OUTPUT_PATH), encoding="utf-8", xml_declaration=True)
    print(f"Written {len(briefs)} brief(s) → {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
