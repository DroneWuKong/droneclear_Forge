"""
M-03 | DroneDJ DFR Tag Miner
Targets:
  https://dronedj.com/guides/dfr/
  https://dronedj.com/tag/dfr/ (if available)
  DroneDJ RSS filtered on DFR keywords
Cadence: daily
Output: data/dfr/raw/dronedj_YYYY-MM-DD.json
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
BASE_URL = "https://dronedj.com"

DFR_KEYWORDS = {
    "drone as first responder", "dfr", "bvlos", "public safety drone",
    "police drone", "fire drone", "sar drone", "search and rescue drone",
    "skydio", "brinc lemur", "flock aerodome", "flock alpha", "flock911",
    "droneresponders", "drone dock", "drone-in-a-box", "drone in a box",
    "beyond visual line", "part 107.145", "cops grant", "dhs ael",
    "flying lion", "skyfireai", "axon air", "nokia drone"
}

RSS_FEEDS = [
    "https://dronedj.com/feed/",
    "https://dronedj.com/category/dfr/feed/",
    "https://dronedj.com/tag/dfr/feed/",
]

HTML_TARGETS = [
    "https://dronedj.com/guides/dfr/",
    "https://dronedj.com/tag/dfr/",
    "https://dronedj.com/category/public-safety/",
]


def is_dfr_relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in DFR_KEYWORDS)


def mine_rss_feeds() -> list[dict]:
    records = []
    for feed_url in RSS_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
            if not feed.entries:
                continue
            print(f"[INFO]  RSS {feed_url} → {len(feed.entries)} entries")
            for entry in feed.entries:
                title = entry.get("title", "")
                summary = entry.get("summary", "") or ""
                link = entry.get("link", "")
                pub = entry.get("published", "") or entry.get("updated", "")
                tags = [t.get("term", "") for t in entry.get("tags", [])]
                combined = f"{title} {summary} {' '.join(tags)}"
                # Include if tagged dfr OR keyword match
                if "dfr" not in [t.lower() for t in tags] and not is_dfr_relevant(combined):
                    continue
                records.append({
                    "id": re.sub(r"[^a-z0-9]", "_", title.lower())[:80],
                    "title": title,
                    "url": link,
                    "source": "dronedj",
                    "pub_date": pub,
                    "tags": tags,
                    "summary": BeautifulSoup(summary, "html.parser").get_text(strip=True)[:500],
                    "vertical_tag": "dfr",
                    "data_category": "market_signal",
                    "relevance_matched": [kw for kw in DFR_KEYWORDS if kw in combined.lower()],
                    "mined_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[WARN] RSS {feed_url} failed: {e}", file=sys.stderr)
    return records


def mine_html_targets() -> list[dict]:
    records = []
    for url in HTML_TARGETS:
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            r.raise_for_status()
            soup = BeautifulSoup(r.text, "html.parser")
            items = (
                soup.select("article.post")
                or soup.select(".article-card")
                or soup.select(".jeg_post")
                or soup.select("article")
            )
            for el in items:
                title_el = el.select_one("h2 a, h3 a, h1 a")
                summary_el = el.select_one(".jeg_post_excerpt p, p.excerpt, p")
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
                    "source": "dronedj",
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
    print("[INFO] Mining DroneDJ RSS feeds...")
    rss_records = mine_rss_feeds()
    print(f"[INFO] Mining DroneDJ HTML targets...")
    html_records = mine_html_targets()
    all_records = rss_records + html_records

    # Deduplicate by URL
    seen = set()
    deduped = []
    for r in all_records:
        key = r.get("url") or r["title"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"dronedj_{TODAY}.json"
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f"[DONE] {len(deduped)} DFR-relevant records → {out_path}")
    return len(deduped)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
