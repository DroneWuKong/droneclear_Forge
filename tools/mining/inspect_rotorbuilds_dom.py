"""
RotorBuilds DOM inspector.

Run this locally (NOT in CI) to capture real page HTML and identify
the selectors needed to fill in rotorbuilds.py parse().

Usage:
    pip install requests beautifulsoup4
    python tools/mining/inspect_rotorbuilds_dom.py

Saves 3 files to tools/mining/output/.cache/:
    rb_explore.html        — /explore index page
    rb_builds.html         — /builds index page
    rb_build_sample.html   — first individual build page found

Then prints a selector report showing what it found.
"""

import json
import re
import time
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    raise SystemExit("pip install requests beautifulsoup4")

CACHE = Path("tools/mining/output/.cache")
CACHE.mkdir(parents=True, exist_ok=True)

HEADERS = {
    "User-Agent": "ForgeMinerBot/0.1 (+https://forgeprole.netlify.app; research@droneclear.ai)",
    "Accept": "text/html,application/xhtml+xml,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch(url: str, cache_name: str, delay: float = 4.0) -> str:
    cache_path = CACHE / cache_name
    if cache_path.exists():
        print(f"  [cache] {cache_name}")
        return cache_path.read_text(encoding="utf-8", errors="replace")
    print(f"  [fetch] {url}")
    time.sleep(delay)
    r = requests.get(url, headers=HEADERS, timeout=20)
    print(f"         → HTTP {r.status_code}, {len(r.text):,} chars")
    if r.status_code == 200:
        cache_path.write_text(r.text, encoding="utf-8")
    return r.text if r.status_code == 200 else ""


def find_build_urls(html: str) -> list[str]:
    """Extract /build/N URLs from an index page."""
    return list(dict.fromkeys(
        "https://rotorbuilds.com" + m
        for m in re.findall(r'href="(/build/\d+[^"#?]*)"', html)
    ))


def inspect_index(html: str, label: str):
    soup = BeautifulSoup(html, "html.parser")
    print(f"\n{'='*60}")
    print(f"INDEX PAGE: {label}")
    print(f"{'='*60}")

    # Find build card containers
    build_urls = find_build_urls(html)
    print(f"Build URLs found (regex): {len(build_urls)}")
    for u in build_urls[:5]:
        print(f"  {u}")

    # Common card selectors
    for sel in [
        "div.build-card", "div.card", "article", "li.build",
        "[class*='build']", "div.explore-item", "div.grid-item",
        "a[href*='/build/']",
    ]:
        hits = soup.select(sel)
        if hits:
            print(f"\nSelector '{sel}': {len(hits)} matches")
            print(f"  First: {str(hits[0])[:200]}")

    # Pagination
    for sel in ["a.next", "a[rel='next']", "a[href*='page=']", ".pagination a", "nav a"]:
        hits = soup.select(sel)
        if hits:
            print(f"\nPagination '{sel}': {len(hits)} matches")
            for h in hits[:3]:
                print(f"  href={h.get('href','')} text={h.get_text(strip=True)[:40]}")


def inspect_build(html: str, url: str):
    soup = BeautifulSoup(html, "html.parser")
    print(f"\n{'='*60}")
    print(f"BUILD PAGE: {url}")
    print(f"{'='*60}")

    # Title
    title = soup.find("title")
    print(f"<title>: {title.get_text(strip=True) if title else 'NOT FOUND'}")

    h1 = soup.find("h1")
    print(f"<h1>:    {h1.get_text(strip=True) if h1 else 'NOT FOUND'}")

    # Parts table / list — most important
    print("\n--- PARTS CONTAINER SEARCH ---")
    for sel in [
        "table", "div.parts", "ul.parts", "div.part-list",
        "[class*='part']", "div.components", "[class*='component']",
        "div.build-parts", "section", "div.specs",
    ]:
        hits = soup.select(sel)
        if hits:
            print(f"'{sel}': {len(hits)} matches")
            print(f"  First 300 chars: {str(hits[0])[:300]}")

    # Table rows if any
    rows = soup.find_all("tr")
    if rows:
        print(f"\n<tr> rows: {len(rows)}")
        for row in rows[:5]:
            cells = [td.get_text(strip=True) for td in row.find_all(["td", "th"])]
            print(f"  {cells}")

    # Look for JSON-LD structured data
    scripts = soup.find_all("script", type="application/ld+json")
    if scripts:
        print(f"\nJSON-LD blocks: {len(scripts)}")
        for s in scripts:
            try:
                data = json.loads(s.string or "")
                print(f"  {json.dumps(data)[:300]}")
            except Exception:
                pass

    # Any inline JSON state (common in React/Vue apps)
    for script in soup.find_all("script"):
        text = script.string or ""
        if "parts" in text.lower() and len(text) > 100:
            print(f"\nScript with 'parts': {text[:400]}")
            break

    # Prop size hints
    prop_sizes = re.findall(r'(\d{1,2})\s*(?:inch|in|")', html[:5000], re.IGNORECASE)
    print(f"\nProp size hints in first 5000 chars: {prop_sizes[:10]}")

    # Summary of all class names used — helps find the right selectors
    all_classes = set()
    for tag in soup.find_all(True):
        for cls in tag.get("class", []):
            all_classes.add(cls)
    build_related = sorted(c for c in all_classes if any(
        kw in c.lower() for kw in ["part", "build", "component", "spec", "motor", "fc", "esc", "frame"]
    ))
    print(f"\nBuild-related class names found: {build_related[:30]}")


if __name__ == "__main__":
    print("RotorBuilds DOM Inspector")
    print("Saving pages to:", CACHE)
    print()

    # 1. Explore index
    explore_html = fetch("https://rotorbuilds.com/explore", "rb_explore.html")
    if explore_html:
        inspect_index(explore_html, "/explore")
        build_urls = find_build_urls(explore_html)
    else:
        print("ERROR: /explore fetch failed — check network/bot block")
        build_urls = []

    # 2. Builds index
    builds_html = fetch("https://rotorbuilds.com/builds", "rb_builds.html")
    if builds_html:
        inspect_index(builds_html, "/builds")
        build_urls += find_build_urls(builds_html)

    # 3. First real build page
    if build_urls:
        sample_url = build_urls[0]
        build_html = fetch(sample_url, "rb_build_sample.html")
        if build_html:
            inspect_build(build_html, sample_url)
        else:
            print(f"ERROR: build page fetch failed ({sample_url})")
    else:
        print("No build URLs discovered — index page may be JS-rendered (needs Selenium/Playwright)")
        print("If so, update rotorbuilds.py to note JS-rendering requirement.")

    print("\nDone. Update rotorbuilds.py parse() with selectors found above.")
    print("Then run: python tools/mining/run_all.py --miner rotorbuilds --max 50 --dry")
