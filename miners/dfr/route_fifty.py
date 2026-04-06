"""
M-06 | Route Fifty / GovTech Municipal DFR Feed
Tracks city/county DFR budget decisions, program launches, NLC announcements.
Cadence: weekly
Output: data/dfr/raw/route_fifty_YYYY-MM-DD.json
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
    "drone as first responder", "dfr", "drone program", "public safety drone",
    "unmanned aircraft", "uas", "suas", "drone", "aerial", "bvlos",
    "skydio", "brinc", "flock", "droneresponders", "national league of cities",
    "drone budget", "drone ordinance", "drone policy", "drone procurement",
    "drone grant", "cops grant", "homeland security grant", "drone technology"
}

SOURCES = [
    {
        "name": "route_fifty",
        "rss": "https://www.route-fifty.com/rss.xml",
        "html": "https://www.route-fifty.com/public-safety",
        "base": "https://www.route-fifty.com",
    },
    {
        "name": "govtech",
        "rss": "https://www.govtech.com/rss.xml",
        "html": "https://www.govtech.com/public-safety/drones",
        "base": "https://www.govtech.com",
    },
    {
        "name": "govexec",
        "rss": "https://www.govexec.com/rss/all/",
        "html": None,
        "base": "https://www.govexec.com",
    },
]


def is_dfr_relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in DFR_KEYWORDS)


def mine_source(source: dict) -> list[dict]:
    records = []

    # Try RSS first
    if source.get("rss"):
        try:
            feed = feedparser.parse(source["rss"])
            for entry in feed.entries:
                title = entry.get("title", "")
                summary = BeautifulSoup(
                    entry.get("summary", "") or "", "html.parser"
                ).get_text(strip=True)
                link = entry.get("link", "")
                pub = entry.get("published", "") or entry.get("updated", "")
                tags = [t.get("term", "") for t in entry.get("tags", [])]
                combined = f"{title} {summary} {' '.join(tags)}"
                if not is_dfr_relevant(combined):
                    continue
                records.append({
                    "id": f"{source['name']}_{re.sub(r'[^a-z0-9]', '_', title.lower())[:60]}",
                    "title": title,
                    "url": link,
                    "source": source["name"],
                    "pub_date": pub[:10] if pub else TODAY,
                    "summary": summary[:500],
                    "tags": tags,
                    "vertical_tag": "dfr",
                    "data_category": "market_signal",
                    "relevance_matched": [kw for kw in DFR_KEYWORDS if kw in combined.lower()],
                    "mined_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[WARN] RSS {source['name']}: {e}", file=sys.stderr)

    # HTML fallback for section pages
    if source.get("html") and not records:
        try:
            r = requests.get(source["html"], headers=HEADERS, timeout=20)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            items = soup.select("article, .story, .card, .post, li.item")
            for el in items:
                title_el = el.select_one("h1 a, h2 a, h3 a, .title a")
                summary_el = el.select_one("p, .excerpt, .description")
                date_el = el.select_one("time, .date")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                href = title_el.get("href", "")
                if href and not href.startswith("http"):
                    href = source["base"] + href
                summary = summary_el.get_text(strip=True)[:500] if summary_el else ""
                pub = date_el.get("datetime", TODAY) if date_el else TODAY
                if not is_dfr_relevant(f"{title} {summary}"):
                    continue
                records.append({
                    "id": f"{source['name']}_{re.sub(r'[^a-z0-9]', '_', title.lower())[:60]}",
                    "title": title,
                    "url": href,
                    "source": source["name"],
                    "pub_date": pub[:10],
                    "summary": summary,
                    "vertical_tag": "dfr",
                    "data_category": "market_signal",
                    "mined_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[WARN] HTML {source['name']}: {e}", file=sys.stderr)

    return records


def run():
    all_records = []
    for source in SOURCES:
        print(f"[INFO] Mining {source['name']}...")
        records = mine_source(source)
        print(f"[INFO]  → {len(records)} DFR-relevant records")
        all_records.extend(records)

    seen = set()
    deduped = []
    for r in all_records:
        key = r.get("url") or r["id"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"route_fifty_{TODAY}.json"
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f"[DONE] {len(deduped)} records → {out_path}")
    return len(deduped)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
