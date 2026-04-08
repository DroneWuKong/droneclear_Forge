"""
M-14 | Payload Dropper / Weapons Release System Miner
Targets:
  - army.mil (SBIR, experimentation, AEWE, Project Convergence articles)
  - armysbir.army.mil (SBIR news)
  - dsiac.dtic.mil (weaponized UAS research)
  - orbitalresearch.com (HKR system updates)
  - armyrecognition.com (dropper field tests)
  - dvidshub.net (live-fire test documentation)

Focus: Military UAS payload release systems, grenade droppers, drop-glide munitions,
       weapons release kits, modular payload systems, 3D-printed field droppers.

Cadence: weekly
Output:  data/defense/raw/payload_droppers_YYYY-MM-DD.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "DroneClear-Forge-Miner/1.0 (research; contact@midwestniceuas.com)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
OUTPUT_DIR = Path("data/defense/raw")
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# ── Target pages ──────────────────────────────────────────────────────────────
TARGET_PAGES = [
    # Orbital Research
    ("https://www.orbitalresearch.com/", "manufacturer", "high"),
    ("https://www.orbitalresearch.com/core-technologies", "manufacturer", "high"),
    ("https://www.orbitalresearch.com/precision-guidance-technologies", "manufacturer", "high"),

    # Army official sources
    ("https://armysbir.army.mil/news/advanced-drone-weaponization-tech-soars-with-army-innovation-funding/", "program", "high"),
    ("https://www.army.mil/article/286759/soldiers_test_suas_borne_live_fire_grenade_drops", "field_test", "high"),

    # DSIAC weaponized UAS overview
    ("https://dsiac.dtic.mil/technical-inquiries/notable/weaponizing-unmanned-aircraft-systems/", "research", "medium"),

    # Army Recognition field test coverage
    ("https://www.armyrecognition.com/focus-analysis-conflicts/army/defence-security-industry-technology/u-s-soldiers-test-3d-printed-widowmaker-grenade-dropper-on-pdw-c100-drone-in-germany", "field_test", "medium"),
    ("https://www.armyrecognition.com/news/army-news/2025/report-us-army-brings-precision-guided-firepower-to-smallest-tactical-formations-with-drone-grenade-system", "field_test", "medium"),

    # DVIDS documentation
    ("https://www.dvidshub.net/news/501870/7atc-devcom-test-suas-borne-live-fire-grenade-drops-gta", "field_test", "medium"),
]

# Keywords that make an article dropper-relevant
DROPPER_KEYWORDS = {
    "payload dropper", "payload release", "drop mechanism", "grenade dropper",
    "weapons release", "munition dropper", "drop-glide", "drop glide",
    "hkr system", "hunt-kill-return", "hunt kill return",
    "audible dropper", "widowmaker", "fpv dropper", "fpv drop",
    "drone drop", "drone-drop", "sUAS dropper", "uas drop",
    "payload delivery", "bomb drop", "grenade drop", "ordnance drop",
    "modular payload", "weaponize drone", "weaponized uas",
    "m67", "fragmentation grenade", "drop munition",
    "carrier electronics", "drone weaponization",
}

# ── Scraping ──────────────────────────────────────────────────────────────────
def fetch(url: str, timeout: int = 15) -> BeautifulSoup | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")
    except Exception as e:
        print(f"[WARN] Failed to fetch {url}: {e}", file=sys.stderr)
        return None


def extract_text(soup: BeautifulSoup) -> str:
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return " ".join(soup.get_text(" ", strip=True).split())


def is_dropper_relevant(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in DROPPER_KEYWORDS)


def extract_facts(url: str, text: str, category: str) -> dict:
    """Pull structured facts from page text."""
    facts = {
        "url": url,
        "category": category,
        "scraped_at": TODAY,
        "dropper_relevant": is_dropper_relevant(text),
        "text_snippet": text[:800],
        "mentions": [],
    }

    # Extract mentions of specific systems
    systems = [
        ("Orbital Research", "HKR", "Hunt-Kill-Return"),
        ("DEVCOM", "Audible"),
        ("Widowmaker",),
        ("Project Shiv",),
        ("drop-glide", "drop glide"),
        ("Carrier Electronics",),
        ("UAVSI", "UAV Systems International"),
    ]
    for group in systems:
        for term in group:
            if term.lower() in text.lower():
                facts["mentions"].append(group[0])
                break

    # Extract dollar amounts (contract values)
    dollars = re.findall(r'\$[\d,.]+\s*(?:million|billion|M|B)?', text)
    if dollars:
        facts["contract_values"] = dollars[:5]

    # Extract program names
    programs = []
    for prog in ["SBIR", "APFIT", "CATALYST", "AEWE", "Project Convergence", "Project Shiv",
                 "Drone Dominance", "Combined Resolve", "DEVCOM"]:
        if prog.lower() in text.lower():
            programs.append(prog)
    if programs:
        facts["programs_mentioned"] = programs

    return facts


# ── Army.mil search for dropper articles ─────────────────────────────────────
ARMY_SEARCH_TERMS = [
    "drone dropper", "payload release drone", "grenade dropper uas",
    "weaponized drone", "drop-glide munition", "drone weaponization"
]

def search_army_mil(term: str) -> list[dict]:
    """Search army.mil for dropper-related articles."""
    results = []
    url = f"https://www.army.mil/search/#q={term.replace(' ', '%20')}&t=All"
    soup = fetch(url)
    if not soup:
        return results
    # army.mil search returns article links
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "/article/" in href and href not in [r.get("url") for r in results]:
            title = a.get_text(strip=True)
            if is_dropper_relevant(title) or is_dropper_relevant(href):
                results.append({"url": href if href.startswith("http") else f"https://www.army.mil{href}",
                                 "title": title, "source": "army.mil search"})
    return results[:5]


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    records = []

    print(f"[INFO] Payload Dropper Miner — {TODAY}")
    print(f"[INFO] Scraping {len(TARGET_PAGES)} target pages...")

    for url, category, priority in TARGET_PAGES:
        print(f"[INFO]   {url}")
        soup = fetch(url)
        if not soup:
            continue
        text = extract_text(soup)
        facts = extract_facts(url, text, category)
        facts["priority"] = priority

        if facts["dropper_relevant"] or priority == "high":
            records.append(facts)
            print(f"  [+] Relevant — mentions: {facts.get('mentions', [])}")
        else:
            print(f"  [-] Not relevant — skipping")

    # Search army.mil for new articles
    print(f"\n[INFO] Searching army.mil for new dropper articles...")
    seen_urls = {r["url"] for r in records}
    for term in ARMY_SEARCH_TERMS[:3]:  # limit to 3 to avoid rate limiting
        hits = search_army_mil(term)
        for hit in hits:
            if hit["url"] not in seen_urls:
                print(f"  [+] Found: {hit['title'][:60]}")
                soup = fetch(hit["url"])
                if soup:
                    text = extract_text(soup)
                    facts = extract_facts(hit["url"], text, "army_search")
                    facts["title"] = hit["title"]
                    records.append(facts)
                    seen_urls.add(hit["url"])

    # Write output
    output_path = OUTPUT_DIR / f"payload_droppers_{TODAY}.json"
    with open(output_path, "w") as f:
        json.dump({"scraped_at": TODAY, "count": len(records), "records": records}, f, indent=2)

    print(f"\n[DONE] {len(records)} records → {output_path}")

    # Summary
    relevant = [r for r in records if r.get("dropper_relevant")]
    print(f"[INFO] {len(relevant)} dropper-relevant pages")
    all_mentions = []
    for r in records:
        all_mentions.extend(r.get("mentions", []))
    from collections import Counter
    for system, count in Counter(all_mentions).most_common():
        print(f"  {system}: {count} mention(s)")


if __name__ == "__main__":
    main()
