#!/usr/bin/env python3
"""
mine_getfpv.py — Scrape getfpv.com product catalog for drone parts.

Targets categories with the biggest data gaps:
  - receivers (267 missing)
  - control_link_tx (137 missing)  
  - fpv_detectors/goggles (30 missing)
  - video_transmitters (21 missing)

Run locally — requires network access to getfpv.com.

Usage:
    python3 miners/commercial/mine_getfpv.py
    python3 miners/commercial/mine_getfpv.py --category receivers
    python3 miners/commercial/mine_getfpv.py --dry-run
"""

import json
import re
import sys
import os
import time
from urllib.request import urlopen, Request
from urllib.parse import urljoin, urlparse, parse_qs
from html.parser import HTMLParser

BASE_URL = "https://www.getfpv.com"

# Category URL → Forge category mapping
CATEGORIES = {
    "receivers": {
        "urls": [
            "/fpv/radio-receivers.html",
            "/fpv/radio-receivers.html?p=2",
            "/fpv/radio-receivers.html?p=3",
            "/fpv/radio-receivers.html?p=4",
        ],
        "forge_cat": "receivers",
    },
    "radios": {
        "urls": [
            "/radios.html",
            "/radios.html?p=2",
            "/radios.html?p=3",
        ],
        "forge_cat": "control_link_tx",
    },
    "goggles": {
        "urls": [
            "/fpv/goggles.html",
            "/fpv/goggles.html?p=2",
        ],
        "forge_cat": "fpv_detectors",
    },
    "vtx": {
        "urls": [
            "/fpv/video-transmitters.html",
            "/fpv/video-transmitters.html?p=2",
        ],
        "forge_cat": "video_transmitters",
    },
    "cameras": {
        "urls": [
            "/fpv/cameras.html",
            "/fpv/cameras.html?p=2",
        ],
        "forge_cat": "fpv_cameras",
    },
    "ndaa": {
        "urls": [
            "/commercial-industry-drones/ndaa-compliant.html",
            "/commercial-industry-drones/ndaa-compliant.html?p=2",
            "/commercial-industry-drones/ndaa-compliant.html?p=3",
        ],
        "forge_cat": "_ndaa_cross_ref",  # Cross-reference, not a direct category
    },
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Forge-Intel-Miner/1.0; +https://forgeprole.netlify.app)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}

RATE_LIMIT = 1.5  # seconds between requests


class ProductListParser(HTMLParser):
    """Extract product links from GetFPV category listing pages."""
    
    def __init__(self):
        super().__init__()
        self.products = []
        self._in_product = False
        self._current = {}
    
    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        cls = attrs_d.get('class', '')
        
        # Product card link
        if tag == 'a' and 'product-item-link' in cls:
            self._current['url'] = attrs_d.get('href', '')
            self._current['name'] = ''
            self._in_product = True
        
        # Product image
        if tag == 'img' and 'product-image-photo' in cls:
            self._current['image'] = attrs_d.get('src', '') or attrs_d.get('data-src', '')
        
        # Price
        if tag == 'span' and 'price' in cls and 'data-price-amount' in attrs_d:
            self._current['price'] = attrs_d.get('data-price-amount', '')
    
    def handle_data(self, data):
        if self._in_product:
            self._current['name'] = (self._current.get('name', '') + ' ' + data).strip()
    
    def handle_endtag(self, tag):
        if tag == 'a' and self._in_product:
            self._in_product = False
            if self._current.get('url') and self._current.get('name'):
                self.products.append(dict(self._current))
            self._current = {}


class ProductDetailParser(HTMLParser):
    """Extract detailed specs from a GetFPV product detail page."""
    
    def __init__(self):
        super().__init__()
        self.data = {
            'description': '',
            'specs': {},
            'sku': '',
            'brand': '',
            'in_stock': True,
            'ndaa': False,
        }
        self._in_desc = False
        self._in_spec_label = False
        self._in_spec_value = False
        self._in_brand = False
        self._current_label = ''
        self._depth = 0
    
    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        cls = attrs_d.get('class', '')
        
        if tag == 'div' and 'product-description' in cls:
            self._in_desc = True
            self._depth = 0
        if self._in_desc and tag == 'div':
            self._depth += 1
        
        # Spec table
        if tag == 'th' and 'col label' in cls:
            self._in_spec_label = True
            self._current_label = ''
        if tag == 'td' and 'col data' in cls:
            self._in_spec_value = True
        
        # Brand
        if tag == 'a' and 'product-brand' in cls:
            self._in_brand = True
        
        # NDAA badge
        if 'ndaa' in cls.lower() or 'ndaa' in attrs_d.get('alt', '').lower():
            self.data['ndaa'] = True
        
        # SKU
        if tag == 'div' and 'product-sku' in cls:
            pass  # Will capture in data
    
    def handle_data(self, data):
        text = data.strip()
        if not text:
            return
        
        if self._in_desc:
            self.data['description'] += text + ' '
        if self._in_spec_label:
            self._current_label += text
        if self._in_spec_value and self._current_label:
            self.data['specs'][self._current_label.strip()] = text
        if self._in_brand:
            self.data['brand'] = text
        if 'ndaa' in text.lower():
            self.data['ndaa'] = True
    
    def handle_endtag(self, tag):
        if tag == 'div' and self._in_desc:
            self._depth -= 1
            if self._depth <= 0:
                self._in_desc = False
        if tag == 'th':
            self._in_spec_label = False
        if tag == 'td':
            self._in_spec_value = False
            self._current_label = ''
        if tag == 'a' and self._in_brand:
            self._in_brand = False


def fetch(url, delay=RATE_LIMIT):
    """Fetch URL with rate limiting and error handling."""
    time.sleep(delay)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  WARN: Failed {url}: {e}", file=sys.stderr)
        return ''


def scrape_category(category_key):
    """Scrape all product listings for a category."""
    config = CATEGORIES[category_key]
    all_products = []
    seen_urls = set()
    
    for listing_url in config['urls']:
        url = BASE_URL + listing_url
        print(f"  Fetching listing: {url}")
        html = fetch(url)
        if not html:
            continue
        
        parser = ProductListParser()
        parser.feed(html)
        
        for p in parser.products:
            if p['url'] not in seen_urls:
                seen_urls.add(p['url'])
                p['category'] = config['forge_cat']
                all_products.append(p)
        
        print(f"    Found {len(parser.products)} products ({len(all_products)} total unique)")
    
    return all_products


def scrape_product_detail(product):
    """Fetch and parse a product detail page."""
    url = product.get('url', '')
    if not url:
        return product
    
    print(f"    Detail: {product.get('name', '')[:50]}")
    html = fetch(url, delay=RATE_LIMIT)
    if not html:
        return product
    
    parser = ProductDetailParser()
    parser.feed(html)
    
    product['description'] = parser.data['description'].strip()[:500]
    product['specs'] = parser.data['specs']
    product['manufacturer'] = parser.data['brand'] or _guess_manufacturer(product.get('name', ''))
    product['ndaa'] = parser.data['ndaa']
    
    return product


def _guess_manufacturer(name):
    """Best-effort manufacturer extraction from product name."""
    known = [
        'RadioMaster', 'TBS', 'FrSky', 'Flysky', 'Spektrum', 'Jumper',
        'BetaFPV', 'ELRS', 'ExpressLRS', 'HappyModel', 'iFlight',
        'Foxeer', 'Caddx', 'Walksnail', 'HDZero', 'DJI', 'Fatshark',
        'Eachine', 'Orqa', 'Skyzone', 'HGLRC', 'Rush', 'Lumenier',
        'Matek', 'Holybro', 'SpeedyBee', 'Diatone', 'EMAX', 'T-Motor',
        'Gemfan', 'HQProp', 'Tattu', 'GNB', 'Auline', 'CNHL',
    ]
    for mfr in known:
        if mfr.lower() in name.lower():
            return mfr
    # Take first word if capitalized
    words = name.split()
    if words and words[0][0:1].isupper():
        return words[0]
    return 'Unknown'


def product_to_forge(product, category):
    """Convert scraped product to Forge DB format."""
    name = product.get('name', '').strip()
    mfr = product.get('manufacturer', 'Unknown')
    
    # Generate PID
    prefix_map = {
        'receivers': 'RCV', 'control_link_tx': 'CTX', 'fpv_detectors': 'GGL',
        'video_transmitters': 'VTX', 'fpv_cameras': 'CAM', 'stacks': 'STK',
    }
    prefix = prefix_map.get(category, 'PRT')
    pid_slug = re.sub(r'[^a-zA-Z0-9]', '-', name)[:30].strip('-')
    pid = f"{prefix}-GFP-{pid_slug}"
    
    price = None
    try:
        price = float(product.get('price', '0').replace('$', '').replace(',', ''))
    except (ValueError, TypeError):
        pass
    
    entry = {
        'pid': pid,
        'name': name,
        'manufacturer': mfr,
        'category': category,
        'description': product.get('description', ''),
        'link': product.get('url', ''),
        'image_file': product.get('image', ''),
        'approx_price': price,
        'source': 'getfpv.com',
        'schema_data': product.get('specs', {}),
    }
    
    if product.get('ndaa'):
        entry['compliance'] = {'ndaa_compliant': True, 'note': 'Listed in GetFPV NDAA section'}
    
    return entry


def merge_into_db(new_parts, db_path, dry_run=False):
    """Merge new parts into forge_database.json with deduplication."""
    with open(db_path) as f:
        db = json.load(f)
    
    # Build index of existing parts by name+manufacturer for dedup
    existing = {}
    for cat, parts in db['components'].items():
        if not isinstance(parts, list):
            continue
        for p in parts:
            key = (p.get('name', '').lower().strip(), p.get('manufacturer', '').lower().strip())
            existing[key] = (cat, p)
    
    added = 0
    updated = 0
    skipped = 0
    
    for part in new_parts:
        key = (part['name'].lower().strip(), part['manufacturer'].lower().strip())
        category = part.pop('category', 'receivers')
        
        if key in existing:
            # Update existing entry with missing fields
            existing_cat, existing_part = existing[key]
            changed = False
            for field in ['link', 'image_file', 'description', 'approx_price']:
                if part.get(field) and not existing_part.get(field):
                    existing_part[field] = part[field]
                    changed = True
            if changed:
                updated += 1
            else:
                skipped += 1
        else:
            # New part — add to DB
            if category not in db['components']:
                db['components'][category] = []
            db['components'][category].append(part)
            existing[key] = (category, part)
            added += 1
    
    print(f"\n  Merge results: {added} added, {updated} updated, {skipped} skipped")
    
    if not dry_run:
        with open(db_path, 'w') as f:
            json.dump(db, f, indent=2)
        print(f"  Written to {db_path}")
    else:
        print("  DRY RUN — not writing")
    
    return added, updated


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Mine GetFPV catalog')
    parser.add_argument('--category', choices=list(CATEGORIES.keys()), help='Specific category')
    parser.add_argument('--dry-run', action='store_true', help='Preview without writing')
    parser.add_argument('--no-detail', action='store_true', help='Skip product detail pages (faster)')
    args = parser.parse_args()
    
    db_path = os.path.join(os.path.dirname(__file__), '..', '..', 
                           'DroneClear Components Visualizer', 'forge_database.json')
    
    categories = [args.category] if args.category else list(CATEGORIES.keys())
    
    all_new = []
    for cat_key in categories:
        print(f"\n{'='*50}")
        print(f"Scraping: {cat_key}")
        print(f"{'='*50}")
        
        products = scrape_category(cat_key)
        
        if not args.no_detail:
            print(f"\n  Fetching {len(products)} product details...")
            for i, p in enumerate(products):
                scrape_product_detail(p)
                if (i + 1) % 10 == 0:
                    print(f"    Progress: {i+1}/{len(products)}")
        
        forge_cat = CATEGORIES[cat_key]['forge_cat']
        for p in products:
            entry = product_to_forge(p, forge_cat)
            all_new.append(entry)
    
    print(f"\n{'='*50}")
    print(f"Total scraped: {len(all_new)} products")
    print(f"{'='*50}")
    
    if all_new:
        # Quality gate — reject garbage before it hits the DB
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
        from validate_entry import validate_parts_batch
        accepted, rejected = validate_parts_batch(all_new)
        if rejected:
            print(f"\n  ⚠️  Quality gate rejected {len(rejected)} entries:")
            for entry, reason in rejected[:10]:
                print(f"    REJECT: \"{entry.get('name','')}\" — {reason}")
            if len(rejected) > 10:
                print(f"    ... and {len(rejected) - 10} more")
        print(f"  ✓ {len(accepted)} entries passed validation")
        merge_into_db(accepted, db_path, dry_run=args.dry_run)
