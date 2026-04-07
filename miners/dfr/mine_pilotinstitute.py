"""
M-09 | Pilot Institute Regulatory Miner
Targets:
  https://pilotinstitute.com/drones/           Federal drone laws wiki
  https://pilotinstitute.com/drones/states/    State-by-state drone laws
  https://pilotinstitute.com/public-safety-bvlos-waivers/
  https://pilotinstitute.com/bvlos-drone-flight/
  https://pilotinstitute.com/fire-department-drones/
  https://pilotinstitute.com/public-safety-drone-programs/
  https://pilotinstitute.com/public-safety-drones/
  https://pilotinstitute.com/public-safety-drones-2/
  https://pilotinstitute.com/paladin-knighthawk-launch/

Focus: BVLOS waivers, DFR regulatory requirements, COA/COW process,
       public safety drone operations, state laws with DFR implications.

Cadence: weekly (content changes infrequently)
Output:  data/dfr/raw/pilotinstitute_YYYY-MM-DD.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestnice.com)"}
OUTPUT_DIR = Path("data/dfr/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# ── Target pages ─────────────────────────────────────────────────────────────
# Each entry: (url, data_category, priority)
REGULATORY_PAGES = [
    ("https://pilotinstitute.com/public-safety-bvlos-waivers/",   "regulatory",     "high"),
    ("https://pilotinstitute.com/bvlos-drone-flight/",            "regulatory",     "high"),
    ("https://pilotinstitute.com/public-safety-drone-programs/",  "regulatory",     "high"),
    ("https://pilotinstitute.com/fire-department-drones/",        "regulatory",     "medium"),
    ("https://pilotinstitute.com/public-safety-drones/",          "market_signal",  "medium"),
    ("https://pilotinstitute.com/public-safety-drones-2/",        "platform_intel", "medium"),
    ("https://pilotinstitute.com/paladin-knighthawk-launch/",     "platform_intel", "medium"),
    ("https://pilotinstitute.com/drones/",                        "regulatory",     "low"),
]

# State pages: mine all 50 — flag those with DFR-relevant statutes
STATE_BASE = "https://pilotinstitute.com/drones/states/"
STATE_DFR_KEYWORDS = {
    "first responder", "public safety", "law enforcement", "police",
    "fire department", "emergency", "bvlos", "beyond visual line",
    "certificate of authorization", "coa", "waiver", "drone program",
    "part 107", "part 91", "night operations", "over people",
}

# Keywords that make an article DFR-relevant
DFR_KEYWORDS = {
    "first responder", "dfr", "drone as first responder",
    "bvlos", "beyond visual line of sight",
    "public safety", "law enforcement", "police drone", "fire drone",
    "certificate of waiver", "cow", "certificate of authorization", "coa",
    "part 91", "part 107", "part 108", "91.113",
    "tactical bvlos", "tbvlos", "shielded operations",
    "detect and avoid", "daa", "airspace waiver",
    "droneresponders", "trust exam", "remote id",
    "public aircraft", "pao", "pso",
    "night operations", "over people", "moving vehicles",
    "sgi", "special governmental interest",
}


def is_relevant(text: str, keyword_set: set = None) -> bool:
    kws = keyword_set or DFR_KEYWORDS
    t = text.lower()
    return any(kw in t for kw in kws)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "_", text.lower())[:80]


def extract_article_text(soup: BeautifulSoup, max_chars: int = 2000) -> str:
    """Extract main article body text, strip nav/footer noise."""
    for tag in soup.select("nav, footer, header, .sidebar, script, style, .advertisement"):
        tag.decompose()
    article = (
        soup.select_one("article")
        or soup.select_one(".entry-content")
        or soup.select_one(".post-content")
        or soup.select_one("main")
        or soup.find("body")
    )
    if not article:
        return ""
    text = article.get_text(separator=" ", strip=True)
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)
    return text[:max_chars]


def extract_regulatory_facts(text: str) -> list[str]:
    """Pull out regulatory sentences (citations, altitudes, procedures)."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    reg_patterns = [
        r"\b(14 CFR|49 USC|part 10[78]|91\.113|107\.\d+)\b",
        r"\b(COA|COW|BVLOS|VLOS|TBVLOS|DAA|ADS-B|LAANC|NOTAM)\b",
        r"\b(200|400) feet?\b",
        r"\b(waiver|authorization|certificate)\b",
        r"\b(DRONERESPONDERS|COPS|HSGP|SHSP|UASI|FEMA)\b",
    ]
    combined = re.compile("|".join(reg_patterns), re.IGNORECASE)
    facts = [s.strip() for s in sentences if combined.search(s) and len(s) > 30]
    return facts[:10]


def mine_page(url: str, data_category: str, priority: str) -> dict | None:
    """Fetch a single page and return a structured record."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=25)
        r.raise_for_status()
    except Exception as e:
        print(f"[WARN] Failed to fetch {url}: {e}", file=sys.stderr)
        return None

    soup = BeautifulSoup(r.text, "html.parser")

    # Title
    title_el = soup.select_one("h1") or soup.select_one("title")
    title = title_el.get_text(strip=True) if title_el else url

    # Date (meta or time tag)
    pub_date = ""
    date_el = soup.select_one("time[datetime]") or soup.select_one(".entry-date")
    if date_el:
        pub_date = date_el.get("datetime", "") or date_el.get_text(strip=True)
    if not pub_date:
        meta_date = soup.find("meta", {"property": "article:published_time"})
        if meta_date:
            pub_date = meta_date.get("content", "")

    body_text = extract_article_text(soup)

    if not is_relevant(f"{title} {body_text}"):
        print(f"[SKIP] Not DFR-relevant: {url}")
        return None

    reg_facts = extract_regulatory_facts(body_text)

    return {
        "id": slug(title),
        "title": title,
        "url": url,
        "source": "pilotinstitute",
        "pub_date": pub_date,
        "summary": body_text[:600],
        "regulatory_facts": reg_facts,
        "vertical_tag": "dfr",
        "data_category": data_category,
        "priority": priority,
        "relevance_matched": [kw for kw in DFR_KEYWORDS if kw in body_text.lower()],
        "mined_at": datetime.now(timezone.utc).isoformat(),
    }


def mine_state_pages() -> list[dict]:
    """
    Scrape the state index, then hit each state page.
    Only keep states with DFR-relevant provisions.
    """
    records = []
    print(f"[INFO] Fetching state index: {STATE_BASE}")
    try:
        r = requests.get(STATE_BASE, headers=HEADERS, timeout=25)
        r.raise_for_status()
    except Exception as e:
        print(f"[WARN] State index failed: {e}", file=sys.stderr)
        return records

    soup = BeautifulSoup(r.text, "html.parser")
    state_links = []
    for a in soup.select("a[href]"):
        href = a["href"]
        if re.match(r"https://pilotinstitute\.com/drones/states/[a-z-]+/$", href):
            if href not in (STATE_BASE, "https://pilotinstitute.com/drones/states/"):
                state_links.append(href)

    state_links = list(dict.fromkeys(state_links))  # dedupe preserve order
    print(f"[INFO] Found {len(state_links)} state pages — checking for DFR provisions...")

    for state_url in state_links:
        state_name = state_url.rstrip("/").split("/")[-1].replace("-", " ").title()
        try:
            sr = requests.get(state_url, headers=HEADERS, timeout=20)
            sr.raise_for_status()
        except Exception as e:
            print(f"[WARN]   {state_name}: {e}", file=sys.stderr)
            continue

        ssoup = BeautifulSoup(sr.text, "html.parser")
        body = extract_article_text(ssoup, max_chars=3000)

        if not is_relevant(body, STATE_DFR_KEYWORDS):
            continue  # state has no DFR-relevant provisions

        title_el = ssoup.select_one("h1") or ssoup.select_one("title")
        title = title_el.get_text(strip=True) if title_el else f"Drone Laws — {state_name}"
        reg_facts = extract_regulatory_facts(body)

        print(f"[INFO]   ✓ {state_name} — DFR provisions found ({len(reg_facts)} regulatory sentences)")
        records.append({
            "id": slug(f"state_laws_{state_name}"),
            "title": title,
            "url": state_url,
            "source": "pilotinstitute_states",
            "pub_date": "",
            "summary": body[:600],
            "regulatory_facts": reg_facts,
            "state": state_name,
            "vertical_tag": "dfr",
            "data_category": "regulatory",
            "priority": "medium",
            "relevance_matched": [kw for kw in STATE_DFR_KEYWORDS if kw in body.lower()],
            "mined_at": datetime.now(timezone.utc).isoformat(),
        })

    return records


def run(skip_states: bool = False) -> int:
    all_records = []

    # ── Regulatory & platform pages ──────────────────────────────────────────
    print(f"[INFO] Mining {len(REGULATORY_PAGES)} target pages...")
    for url, category, priority in REGULATORY_PAGES:
        print(f"[INFO]   {url}")
        rec = mine_page(url, category, priority)
        if rec:
            all_records.append(rec)
            print(f"[INFO]   ✓ '{rec['title'][:60]}' ({len(rec['regulatory_facts'])} reg facts)")

    # ── State pages ──────────────────────────────────────────────────────────
    if not skip_states:
        print(f"\n[INFO] Mining state pages for DFR provisions...")
        state_records = mine_state_pages()
        all_records.extend(state_records)
        print(f"[INFO] {len(state_records)} states with DFR-relevant provisions")

    # ── Deduplicate by URL ───────────────────────────────────────────────────
    seen = set()
    deduped = []
    for r in all_records:
        key = r.get("url", r["title"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / f"pilotinstitute_{TODAY}.json"
    out_path.write_text(json.dumps(deduped, indent=2))
    print(f"\n[DONE] {len(deduped)} records → {out_path}")

    # ── Summary ──────────────────────────────────────────────────────────────
    cats = {}
    for r in deduped:
        c = r["data_category"]
        cats[c] = cats.get(c, 0) + 1
    for c, n in sorted(cats.items()):
        print(f"       {c}: {n}")

    return len(deduped)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Pilot Institute DFR regulatory miner")
    parser.add_argument("--skip-states", action="store_true", help="Skip state law pages (faster dev run)")
    args = parser.parse_args()
    count = run(skip_states=args.skip_states)
    sys.exit(0 if count >= 0 else 1)
