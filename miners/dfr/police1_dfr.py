"""
M-02 | Police1 / PoliceMag DFR Feed Miner
Targets:
  https://www.police1.com/drones/
  https://www.policemag.com (drone/DFR articles)
Cadence: daily
Output: data/dfr/raw/police1_YYYY-MM-DD.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import feedparser
import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

DFR_KEYWORDS = {
    "drone as first responder", "dfr", "bvlos", "beyond visual line of sight",
    "drone program", "public safety drone", "police drone", "fire drone",
    "skydio", "brinc", "flock aerodome", "flock alpha", "droneresponders",
    "part 107.145", "beyond authorization", "drone dock", "drone in a box",
    "cops grant", "homeland security drone", "ndaa drone"
}

SOURCES = [
    {
        "name": "police1_drones",
        "rss": "https://www.police1.com/drones/rss.xml",
        "fallback_html": "https://www.police1.com/drones/",
        "base_url": "https://www.police1.com",
    },
    {
        "name": "policemag",
        "rss": "https://www.policemag.com/rss.xml",
        "fallback_html": "https://www.policemag.com/drones/",
        "base_url": "https://www.policemag.com",
    },
]


def is_dfr_relevant(text: str) -> bool:
    text_lower = text.lower()
    return any(kw in text_lower for kw in DFR_KEYWORDS)


def mine_rss(source: dict) -> list[dict]:
    records = []
    try:
        feed = feedparser.parse(source["rss"])
        for entry in feed.entries:
            title = entry.get("title", "")
            summary = entry.get("summary", "") or entry.get("description", "")
            link = entry.get("link", "")
            pub = entry.get("published", "") or entry.get("updated", "")
            combined = f"{title} {summary}"
            if not is_dfr_relevant(combined):
                continue
            records.append({
                "id": re.sub(r"[^a-z0-9]", "_", title.lower())[:80],
                "title": title,
                "url": link,
                "source": source["name"],
                "pub_date": pub,
                "summary": BeautifulSoup(summary, "html.parser").get_text(strip=True)[:500],
                "vertical_tag": "dfr",
                "data_category": "market_signal",
                "relevance_matched": [kw for kw in DFR_KEYWORDS if kw in combined.lower()],
                "mined_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as e:
        print(f"[WARN] RSS failed for {source['name']}: {e}", file=sys.stderr)
    return records


def mine_html_fallback(source: dict) -> list[dict]:
    records = []
    try:
        r = requests.get(source["fallback_html"], headers=HEADERS, timeout=20)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        items = (
            soup.select("article")
            or soup.select(".story")
            or soup.select(".article-card")
            or soup.select("li.list-item")
        )
        for el in items:
            title_el = el.select_one("h1, h2, h3, a")
            link_el = el.select_one("a[href]")
            summary_el = el.select_one("p, .excerpt")
            date_el = el.select_one("time, .date")
            title = title_el.get_text(strip=True) if title_el else ""
            href = link_el["href"] if link_el else ""
            if href and not href.startswith("http"):
                href = source["base_url"] + href
            summary = summary_el.get_text(strip=True)[:500] if summary_el else ""
            pub = date_el.get("datetime", "") if date_el else ""
            if not title or not is_dfr_relevant(f"{title} {summary}"):
                continue
            records.append({
                "id": re.sub(r"[^a-z0-9]", "_", title.lower())[:80],
                "title": title,
                "url": href,
                "source": source["name"],
                "pub_date": pub,
                "summary": summary,
                "vertical_tag": "dfr",
                "data_category": "market_signal",
                "mined_at": datetime.now(timezone.utc).isoformat(),
            })
    except Exception as e:
        print(f"[WARN] HTML fallback failed for {source['name']}: {e}", file=sys.stderr)
    return records


def run():
    all_records = []
    for source in SOURCES:
        print(f"[INFO] Mining {source['name']} via RSS...")
        records = mine_rss(source)
        if not records:
            print(f"[INFO]  → RSS empty, trying HTML fallback...")
            records = mine_html_fallback(source)
        print(f"[INFO]  → {len(records)} DFR-relevant records")
        all_records.extend(records)

    # Deduplicate by URL
    seen = set()
    deduped = []
    for r in all_records:
        key = r.get("url") or r["title"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"police1_{TODAY}.json"
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f"[DONE] {len(deduped)} records → {out_path}")
    return len(deduped)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
