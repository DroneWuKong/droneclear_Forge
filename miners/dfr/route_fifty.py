"""
M-06 | GovTech / Municipal Intelligence Miner
Sources: StateScoop, SmartCitiesWorld, FCW, PublicSafetyTech — 
covers municipal tech procurement and first responder innovation.
Cadence: weekly
Output: data/dfr/raw/route_fifty_YYYY-MM-DD.json
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
    "police drone","fire drone","search and rescue","ems drone",
    "skydio","brinc","flock","paladin","american robotics",
    "drone dock","drone-in-a-box","drone in a box",
    "beyond visual line","cops grant","uasi grant","hsgp",
    "homeland security grant","fema grant","drone program",
    "municipal drone","law enforcement drone","fire department drone",
    "911 drone","dispatch drone","first responder drone",
    "drone technology","unmanned aircraft","uas","uav"
}

SOURCES = [
    {"name": "statescoop",     "rss": "https://statescoop.com/feed/"},
    {"name": "smartcities",    "rss": "https://smartcitiesworld.net/rss.xml"},
    {"name": "fcw",            "rss": "https://fcw.com/rss-feeds/all.aspx"},
    {"name": "defenseone",     "rss": "https://www.defenseone.com/rss/all/"},
]

def parse_date(raw: str) -> str:
    if not raw: return TODAY
    try: return parsedate_to_datetime(raw).strftime("%Y-%m-%d")
    except Exception: pass
    m = re.search(r"(\d{4}-\d{2}-\d{2})", raw)
    return m.group(1) if m else TODAY

def is_relevant(text: str) -> bool:
    return any(kw in text.lower() for kw in DFR_KEYWORDS)

def run():
    records, seen = [], set()
    for src in SOURCES:
        try:
            feed = feedparser.parse(src["rss"])
            hits = 0
            for e in feed.entries:
                title   = e.get("title","")
                summary = BeautifulSoup(e.get("summary","") or "", "html.parser").get_text(strip=True)[:500]
                link    = e.get("link","")
                pub_raw = e.get("published","") or e.get("updated","")
                if link in seen or not is_relevant(f"{title} {summary}"):
                    continue
                seen.add(link)
                hits += 1
                records.append({
                    "id": re.sub(r"[^a-z0-9]","_",title.lower())[:80],
                    "title": title, "url": link, "source": src["name"],
                    "pub_date": parse_date(pub_raw), "summary": summary,
                    "vertical_tag": "dfr", "data_category": "market_signal",
                    "relevance_matched": [kw for kw in DFR_KEYWORDS if kw in f"{title} {summary}".lower()],
                    "mined_at": datetime.now(timezone.utc).isoformat(),
                })
            print(f"[INFO] {src['name']}: {len(feed.entries)} entries, {hits} relevant")
        except Exception as ex:
            print(f"[WARN] {src['name']}: {ex}", file=sys.stderr)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUTPUT_DIR / f"route_fifty_{TODAY}.json"
    out.write_text(json.dumps(records, indent=2))
    print(f"[DONE] {len(records)} records → {out}")
    return len(records)

if __name__ == "__main__":
    sys.exit(0 if run() >= 0 else 1)
