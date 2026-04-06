"""
M-01 | DRONERESPONDERS Feed Miner
Target: https://droneresponders.org
Cadence: weekly
Output: data/dfr/raw/droneresponders_YYYY-MM-DD.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://droneresponders.org"
HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

TARGETS = [
    {"url": f"{BASE_URL}/news", "section": "news"},
    {"url": f"{BASE_URL}/resources", "section": "resources"},
    {"url": f"{BASE_URL}/blog", "section": "blog"},
]


def fetch(url: str) -> BeautifulSoup | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        print(f"[WARN] fetch failed {url}: {e}", file=sys.stderr)
        return None


def extract_articles(soup: BeautifulSoup, section: str, source_url: str) -> list[dict]:
    records = []
    # Try common article/card patterns
    candidates = (
        soup.select("article")
        or soup.select(".post")
        or soup.select(".entry")
        or soup.select(".card")
        or soup.select("li.news-item")
        or soup.select(".resource-item")
    )
    for el in candidates:
        title_el = el.select_one("h1, h2, h3, h4, a")
        link_el = el.select_one("a[href]")
        date_el = el.select_one("time, .date, .published, .post-date")
        summary_el = el.select_one("p, .excerpt, .summary, .description")

        title = title_el.get_text(strip=True) if title_el else ""
        href = link_el["href"] if link_el else ""
        if href and not href.startswith("http"):
            href = BASE_URL.rstrip("/") + "/" + href.lstrip("/")
        pub_date = date_el.get("datetime") or (date_el.get_text(strip=True) if date_el else "")
        summary = summary_el.get_text(strip=True)[:500] if summary_el else ""

        if not title or len(title) < 5:
            continue

        records.append({
            "id": re.sub(r"[^a-z0-9]", "_", title.lower())[:80],
            "title": title,
            "url": href,
            "source": "droneresponders",
            "section": section,
            "source_url": source_url,
            "pub_date": pub_date,
            "summary": summary,
            "vertical_tag": "dfr",
            "data_category": "market_signal",
            "mined_at": datetime.now(timezone.utc).isoformat(),
        })
    return records


def run():
    all_records = []
    for target in TARGETS:
        print(f"[INFO] Fetching {target['url']}")
        soup = fetch(target["url"])
        if soup:
            records = extract_articles(soup, target["section"], target["url"])
            print(f"[INFO]  → {len(records)} records from {target['section']}")
            all_records.extend(records)

    # Deduplicate by URL
    seen = set()
    deduped = []
    for r in all_records:
        key = r["url"] or r["title"]
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"droneresponders_{TODAY}.json"
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f"[DONE] {len(deduped)} records → {out_path}")
    return len(deduped)


if __name__ == "__main__":
    count = run()
    sys.exit(0 if count >= 0 else 1)
