"""
M-01 | DFR Community + Industry Miner
Sources: DRONERESPONDERS (scrape), Route Fifty, GovExec, EMS1 — 
public safety focused press covering municipal DFR programs.
Cadence: weekly
Output: data/dfr/raw/droneresponders_YYYY-MM-DD.json
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
    "police drone","fire drone","sar","search and rescue","ems drone",
    "skydio","brinc","flock","paladin","american robotics",
    "droneresponders","drone dock","drone-in-a-box","drone in a box",
    "beyond visual line","cops grant","uasi","homeland security grant",
    "flying lion","axon air","dronesense","911 drone","dispatch drone",
    "municipal drone","law enforcement drone","fire department drone",
    "cow waiver","certificate of waiver","beyond authorization",
    "drone program","first responder"
}

SOURCES = [
    {"name": "route_fifty",    "rss": "https://www.route-fifty.com/rss.xml"},
    {"name": "govexec",        "rss": "https://www.govexec.com/rss/all/"},
    {"name": "ems1_drone",     "rss": "https://www.ems1.com/rss/sections/technology.rss"},
    {"name": "police1_tech",   "rss": "https://www.police1.com/rss/sections/technology.rss"},
    {"name": "firerescue1",    "rss": "https://www.firerescue1.com/rss/sections/technology.rss"},
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
    out = OUTPUT_DIR / f"droneresponders_{TODAY}.json"
    out.write_text(json.dumps(records, indent=2))
    print(f"[DONE] {len(records)} records → {out}")
    return len(records)

if __name__ == "__main__":
    sys.exit(0 if run() >= 0 else 1)
