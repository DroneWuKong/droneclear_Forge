#!/usr/bin/env python3
"""
fetch_platform_images.py — Fetch OG/meta images from manufacturer product pages

Run locally (not in Claude's sandbox) with full network access.
Fetches og:image meta tags from manufacturer product pages and updates forge_database.json.

Usage:
    python3 fetch_platform_images.py                    # fetch all missing
    python3 fetch_platform_images.py --verify            # verify existing URLs still resolve
    python3 fetch_platform_images.py --dry-run           # show what would be fetched
"""

import json, re, sys, time, argparse
from pathlib import Path

try:
    import requests
except ImportError:
    print("pip install requests")
    sys.exit(1)

DB_PATH = Path(__file__).parent.parent / "DroneClear Components Visualizer" / "forge_database.json"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

# PID -> manufacturer product page URL
# Add entries here as you find them
PRODUCT_PAGES = {
    # DJI Enterprise
    'MDL-2000': 'https://enterprise.dji.com/matrice-350-rtk',
    'MDL-2001': 'https://enterprise.dji.com/matrice-30',
    'MDL-2010': 'https://ag.dji.com/t50',
    'MDL-2011': 'https://www.dji.com/flycart-30',
    'MDL-2018': 'https://enterprise.dji.com/mavic-3-enterprise',
    'MDL-2046': 'https://www.dji.com/mavic-4-pro',
    'MDL-2047': 'https://enterprise.dji.com/matrice-4-series',
    # Autel
    'MDL-2002': 'https://www.autelrobotics.com/evo-max-4t/',
    'MDL-2048': 'https://www.autelrobotics.com/evo-ii-enterprise-v3/',
    # Skydio
    'MDL-2003': 'https://www.skydio.com/x10',
    # Blue UAS / COTS
    'MDL-2004': 'https://freeflysystems.com/astro',
    'MDL-2005': 'https://inspiredflight.com/if1200a/',
    'MDL-2006': 'https://tealdrones.com/teal-2/',
    'MDL-2007': 'https://www.parrot.com/us/drones/anafi-usa',
    'MDL-2013': 'https://wingtra.com/mapping-drone-wingtraone/',
    'MDL-2014': 'https://www.xa.com/en/p100pro',
    'MDL-2015': 'https://hylio.com/ag-272/',
    'MDL-2016': 'https://www.sensefly.com/drone/ebee-x-fixed-wing-drone/',
    'MDL-2017': 'https://quantum-systems.com/trinity-pro/',
    # Defense / Tactical
    'MDL-2008': 'https://www.anduril.com/hardware/ghost/',
    'MDL-2020': 'https://shield.ai/nova/',
    'MDL-2021': 'https://neros.tech/',
    'MDL-2024': 'https://www.redcatholdings.com/fang',
    'MDL-2025': 'https://www.modalai.com/pages/seeker',
    'MDL-2029': 'https://www.titandynamics.ai/',
    'MDL-2030': 'https://vantagerobotics.com/vesper/',
    'MDL-2033': 'https://shield.ai/v-bat/',
    'MDL-2034': 'https://quantum-systems.com/vector/',
    'MDL-2035': 'https://www.avinc.com/tms/switchblade',
    'MDL-2038': 'https://www.anduril.com/hardware/bolt/',
    'MDL-2050': 'https://www.redcatholdings.com/black-widow',
    'MDL-2012': 'https://www.flyability.com/elios-3',
    'MDL-2009': 'https://holybro.com/products/x500-v2-kit',
    'MDL-2054': 'https://orfrqa.com/mrm2-10/',
    'MDL-2055': 'https://orfrqa.com/mrm2-10f/',
    'MDL-2056': 'https://orfrqa.com/mrm1-5/',
    # Baykar
    'DM-0034': 'https://baykartech.com/en/uav/bayraktar-tb2/',
    'DM-0035': 'https://baykartech.com/en/uav/bayraktar-akinci/',
    'DM-0036': 'https://baykartech.com/en/uav/bayraktar-tb3/',
    'DM-0037': 'https://baykartech.com/en/uav/bayraktar-kizilelma/',
    # European / International
    'DM-0128': 'https://www.schiebel.net/products/camcopter-s-100/',
    'DM-0142': 'https://elbitsystems.com/product/hermes-900/',
    'DM-0143': 'https://elbitsystems.com/product/hermes-450/',
    'DM-0011': 'https://www.safran-group.com/products-services/patroller-tactical-drone',
    'DM-0016': 'https://www.deltaquad.com/products/deltaquad-evo/',
}


def fetch_og_image(url):
    """Fetch a page and extract og:image or twitter:image meta tag."""
    try:
        r = requests.get(url, headers=HEADERS, timeout=15, allow_redirects=True)
        if r.status_code != 200:
            return None
        html = r.text[:80000]
        
        # Try og:image
        for pattern in [
            r'<meta\s+(?:property|name)=["\']og:image["\']\s+content=["\'](https?://[^"\']+)["\']',
            r'content=["\'](https?://[^"\']+)["\']\s+(?:property|name)=["\']og:image["\']',
            r'<meta\s+(?:property|name)=["\']twitter:image["\']\s+content=["\'](https?://[^"\']+)["\']',
            r'content=["\'](https?://[^"\']+)["\']\s+(?:property|name)=["\']twitter:image["\']',
        ]:
            m = re.search(pattern, html, re.I)
            if m:
                return m.group(1)
        
        return None
    except Exception as e:
        print(f"  ⚠ {e}")
        return None


def verify_image(url):
    """Verify image URL resolves to an actual image."""
    try:
        r = requests.head(url, headers=HEADERS, timeout=8, allow_redirects=True)
        ct = r.headers.get('content-type', '')
        if r.status_code == 200 and 'image' in ct:
            return True
        if r.status_code in (403, 405):
            r2 = requests.get(url, headers={**HEADERS, 'Range': 'bytes=0-100'}, timeout=8)
            return r2.status_code in (200, 206)
    except:
        pass
    return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify', action='store_true', help='Verify existing URLs')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be fetched')
    parser.add_argument('--db', default=str(DB_PATH), help='Path to forge_database.json')
    args = parser.parse_args()

    db = json.load(open(args.db))
    models = db.get('drone_models', [])
    pid_map = {m.get('pid'): m for m in models}

    if args.verify:
        print("Verifying existing image URLs...")
        for m in models:
            url = m.get('image_url')
            if url:
                ok = verify_image(url)
                status = "✅" if ok else "❌ BROKEN"
                print(f"  {m.get('pid'):10s} {status} {url[:70]}")
        return

    if args.dry_run:
        print("Would fetch images for:")
        for pid, url in PRODUCT_PAGES.items():
            m = pid_map.get(pid)
            has = "✅ has image" if m and m.get('image_url') else "❌ needs image"
            name = m.get('name', '?')[:40] if m else '?'
            print(f"  {pid:10s} {has} {name} → {url[:60]}")
        return

    # Fetch
    results = {}
    for pid, url in PRODUCT_PAGES.items():
        m = pid_map.get(pid)
        if not m:
            continue
        if m.get('image_url'):
            print(f"  {pid}: already has image, skipping")
            continue
        
        print(f"Fetching {pid} ({m.get('name','?')[:35]}): {url}")
        img = fetch_og_image(url)
        if img:
            valid = verify_image(img)
            status = "✅" if valid else "⚠ unverified"
            print(f"  {status} {img[:80]}")
            if valid:
                m['image_url'] = img
                results[pid] = img
        else:
            print(f"  ❌ No OG image found")
        time.sleep(1)

    print(f"\nApplied: {len(results)} new images")
    
    has_img = sum(1 for m in models if m.get('image_url'))
    print(f"Total with image_url: {has_img}/{len(models)}")

    with open(args.db, 'w') as f:
        json.dump(db, f, indent=2)
    print(f"✅ Saved to {args.db}")


if __name__ == '__main__':
    main()
