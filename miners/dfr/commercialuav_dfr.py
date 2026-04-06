"""
M-04 | Commercial UAV News DFR Filter
Extends existing commercialuav miner with DFR vertical tag.
Target: https://www.commercialuavnews.com/public-safety
Cadence: daily
Output: data/dfr/raw/commercialuav_dfr_YYYY-MM-DD.json
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
BASE_URL = "https://www.commercialuavnews.com"

DFR_KEYWORDS = {
    "drone as first responder", "dfr", "bvlos", "public safety",
    "law enforcement", "police drone", "fire department drone",
    "search and rescue", "sar", "municipal drone", "first responder",
    "skydio", "brinc", "flock aerodome", "flock alpha", "droneresponders",
    "drone dock", "drone-in-a-box", "beyond authorization", "part 107.145",
    "cops grant", "dhs ael", "flying lion", "skyfireai"
}

RSS_FEEDS = [
    "https://www.commercialuavnews.com/feed",
    "https://www.commercialuavnews.com/public-safety/feed",
]

HTML_TARGETS = [
    f"{BASE_URL}/public-safety",
    f"{BASE_URL}/category/public-safety",
]


def is_dfr_relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in DFR_KEYWORDS)


def mine_rss() -> list[dict]:
    records = []
    for feed_url in RSS_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
            for entry in feed.entries:
                title = entry.get("title", "")
                summary = BeautifulSoup(
                    entry.get("summary", "") or "", "html.parser"
                ).get_text(strip=True)
                link = entry.get("link", "")
                pub = entry.get("published", "") or entry.get("updated", "")
                cats = [c.get("term", "").lower() for c in entry.get("tags", [])]
                combined = f"{title} {summary} {' '.join(cats)}"
                if not is_dfr_relevant(combined):
                    continue
                records.append({
                    "id": re.sub(r"[^a-z0-9]", "_", title.lower())[:80],
                    "title": title,
                    "url": link,
                    "source": "commercialuavnews",
                    "pub_date": pub,
                    "categories": cats,
                    "summary": summary[:500],
                    "vertical_tag": "dfr",
                    "data_category": "market_signal",
                    "relevance_matched": [kw for kw in DFR_KEYWORDS if kw in combined.lower()],
                    "mined_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[WARN] RSS {feed_url} failed: {e}", file=sys.stderr)
    return records


def mine_html() -> list[dict]:
    records = []
    for url in HTML_TARGETS:
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            items = soup.select("article") or soup.select(".post") or soup.select(".entry")
            for el in items:
                title_el = el.select_one("h2 a, h3 a, h1 a, .entry-title a")
                summary_el = el.select_one(".entry-summary p, .excerpt, p")
                date_el = el.select_one("time")
                if not title_el:
                    continue
                title = title_el.get_text(strip=True)
                href = title_el.get("href", "")
                if href and not href.startswith("http"):
                    href = BASE_URL + href
                summary = summary_el.get_text(strip=True)[:500] if summary_el else ""
                pub = date_el.get("datetime", "") if date_el else ""
                if not is_dfr_relevant(f"{title} {summary}"):
                    continue
                records.append({
                    "id": re.sub(r"[^a-z0-9]", "_", title.lower())[:80],
                    "title": title,
                    "url": href,
                    "source": "commercialuavnews",
                    "pub_date": pub,
                    "summary": summary,
                    "vertical_tag": "dfr",
                    "data_category": "market_signal",
                    "mined_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[WARN] HTML {url} failed: {e}", file=sys.stderr)
    return records


def run():
    print("[INFO] Mining Commercial UAV News for DFR content...")
    records = mine_rss() + mine_html()
    seen = set()
    deduped = []
    for r in records:
        key = r.get("url") or r["title"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"commercialuav_dfr_{TODAY}.json"
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f"[DONE] {len(deduped)} DFR-relevant records → {out_path}")
    return len(deduped)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
