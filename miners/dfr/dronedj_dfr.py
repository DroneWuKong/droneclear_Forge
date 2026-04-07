"""
M-03 | DroneDJ DFR Tag Miner
Targets DroneDJ RSS + public-safety/dfr keyword filter.
Cadence: daily
Output: data/dfr/raw/dronedj_YYYY-MM-DD.json
"""
import json, re, sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
import feedparser
from bs4 import BeautifulSoup

OUTPUT_DIR = Path("data/dfr/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

DFR_KEYWORDS = {
    "drone as first responder","dfr","bvlos","public safety drone",
    "police drone","fire drone","sar drone","search and rescue",
    "skydio","brinc","flock aerodome","flock alpha",
    "droneresponders","drone dock","drone-in-a-box","drone in a box",
    "beyond visual line","cops grant","dhs ael",
    "flying lion","axon air","nokia drone","paladin","american robotics"
}

RSS_FEEDS = [
    "https://dronedj.com/feed/",
    "https://dronedj.com/category/public-safety/feed/",
    "https://dronedj.com/tag/public-safety/feed/",
]

def parse_date(raw: str) -> str:
    """Normalize any date string to YYYY-MM-DD."""
    if not raw:
        return TODAY
    try:
        return parsedate_to_datetime(raw).strftime("%Y-%m-%d")
    except Exception:
        pass
    # ISO / partial ISO
    m = re.search(r"(\d{4}-\d{2}-\d{2})", raw)
    return m.group(1) if m else TODAY

def is_relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in DFR_KEYWORDS)

def run():
    records, seen = [], set()
    for url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            print(f"[INFO] {url} → {len(feed.entries)} entries")
            for e in feed.entries:
                title   = e.get("title", "")
                summary = BeautifulSoup(e.get("summary","") or "", "html.parser").get_text(strip=True)[:500]
                link    = e.get("link","")
                pub_raw = e.get("published","") or e.get("updated","")
                tags    = [t.get("term","") for t in e.get("tags",[])]
                combined = f"{title} {summary} {' '.join(tags)}"
                if link in seen or (not is_relevant(combined) and "dfr" not in [t.lower() for t in tags]):
                    continue
                seen.add(link)
                records.append({
                    "id": re.sub(r"[^a-z0-9]","_",title.lower())[:80],
                    "title": title, "url": link, "source": "dronedj",
                    "pub_date": parse_date(pub_raw),
                    "summary": summary, "tags": tags,
                    "vertical_tag": "dfr", "data_category": "market_signal",
                    "relevance_matched": [kw for kw in DFR_KEYWORDS if kw in combined.lower()],
                    "mined_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[WARN] {url}: {e}", file=sys.stderr)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / f"dronedj_{TODAY}.json"
    out.write_text(json.dumps(records, indent=2))
    print(f"[DONE] {len(records)} records → {out}")
    return len(records)

if __name__ == "__main__":
    sys.exit(0 if run() >= 0 else 1)
