#!/usr/bin/env python3
"""
mine_rdq.py — Scrape racedayquads.com for drone parts.

Primary use: price comparison against GetFPV data + find parts not in DB.
RDQ uses Shopify so the structure is consistent.

Run locally — requires network access to racedayquads.com.

Usage:
    python3 miners/commercial/mine_rdq.py
    python3 miners/commercial/mine_rdq.py --dry-run
"""

import json
import re
import sys
import os
import time
from urllib.request import urlopen, Request

BASE_URL = "https://www.racedayquads.com"

# RDQ uses Shopify — products available via /products.json API
# This is the cleanest extraction method — structured JSON, no HTML parsing needed
COLLECTION_URLS = [
    "/collections/fpv-cameras/products.json",
    "/collections/video-transmitters/products.json",
    "/collections/radio-receivers/products.json",
    "/collections/radio-transmitters/products.json",
    "/collections/fpv-goggles/products.json",
    "/collections/flight-controllers/products.json",
    "/collections/escs/products.json",
    "/collections/frames/products.json",
    "/collections/motors/products.json",
    "/collections/propellers/products.json",
    "/collections/batteries/products.json",
    "/collections/antennas/products.json",
    "/collections/gps-modules/products.json",
]

# Map RDQ collections to Forge categories
COLLECTION_MAP = {
    'fpv-cameras': 'fpv_cameras',
    'video-transmitters': 'video_transmitters',
    'radio-receivers': 'receivers',
    'radio-transmitters': 'control_link_tx',
    'fpv-goggles': 'fpv_detectors',
    'flight-controllers': 'flight_controllers',
    'escs': 'escs',
    'frames': 'frames',
    'motors': 'motors',
    'propellers': 'propellers',
    'batteries': 'batteries',
    'antennas': 'antennas',
    'gps-modules': 'gps_modules',
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Forge-Intel-Miner/1.0; +https://forgeprole.netlify.app)",
    "Accept": "application/json",
}

RATE_LIMIT = 1.0


def fetch_json(url):
    """Fetch JSON from Shopify products API."""
    time.sleep(RATE_LIMIT)
    req = Request(url, headers=HEADERS)
    try:
        with urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"  WARN: Failed {url}: {e}", file=sys.stderr)
        return None


def fetch_collection(collection_path):
    """Fetch all products from a Shopify collection (handles pagination)."""
    all_products = []
    page = 1
    
    while True:
        url = f"{BASE_URL}{collection_path}?page={page}&limit=250"
        print(f"  Fetching: {collection_path} (page {page})")
        data = fetch_json(url)
        
        if not data or not data.get('products'):
            break
        
        products = data['products']
        all_products.extend(products)
        print(f"    Got {len(products)} products ({len(all_products)} total)")
        
        if len(products) < 250:
            break  # Last page
        page += 1
    
    return all_products


def shopify_to_forge(product, forge_category):
    """Convert Shopify product JSON to Forge DB format."""
    name = product.get('title', '').strip()
    vendor = product.get('vendor', 'Unknown')
    
    # Get primary variant for pricing
    variants = product.get('variants', [])
    price = None
    if variants:
        try:
            price = float(variants[0].get('price', '0'))
        except (ValueError, TypeError):
            pass
    
    # Get primary image
    images = product.get('images', [])
    image_url = images[0].get('src', '') if images else ''
    
    # Clean description (strip HTML tags)
    desc = product.get('body_html', '')
    desc = re.sub(r'<[^>]+>', ' ', desc)
    desc = re.sub(r'\s+', ' ', desc).strip()[:500]
    
    # Generate PID
    prefix_map = {
        'receivers': 'RCV', 'control_link_tx': 'CTX', 'fpv_detectors': 'GGL',
        'video_transmitters': 'VTX', 'fpv_cameras': 'CAM', 'flight_controllers': 'FC',
        'escs': 'ESC', 'frames': 'FRM', 'motors': 'MTR', 'propellers': 'PRP',
        'batteries': 'BAT', 'antennas': 'ANT', 'gps_modules': 'GPS',
    }
    prefix = prefix_map.get(forge_category, 'PRT')
    handle = product.get('handle', '')[:30]
    pid = f"{prefix}-RDQ-{handle}"
    
    # Check tags for NDAA
    tags = [t.strip().lower() for t in product.get('tags', '').split(',') if t.strip()]
    ndaa = any('ndaa' in t for t in tags)
    
    entry = {
        'pid': pid,
        'name': name,
        'manufacturer': vendor,
        'category': forge_category,
        'description': desc,
        'link': f"{BASE_URL}/products/{product.get('handle', '')}",
        'image_file': image_url,
        'approx_price': price,
        'source': 'racedayquads.com',
        'rdq_tags': tags,
        'schema_data': {
            'tags': [t for t in tags if t not in ('new', 'sale', 'featured')],
        },
    }
    
    if ndaa:
        entry['compliance'] = {'ndaa_compliant': True, 'note': 'Tagged NDAA on RDQ'}
    
    # In-stock check
    entry['in_stock'] = any(v.get('available', False) for v in variants)
    
    return entry


def merge_into_db(new_parts, db_path, dry_run=False):
    """Merge new parts into forge_database.json with deduplication."""
    with open(db_path) as f:
        db = json.load(f)
    
    existing = {}
    for cat, parts in db['components'].items():
        if not isinstance(parts, list):
            continue
        for p in parts:
            key = (p.get('name', '').lower().strip(), p.get('manufacturer', '').lower().strip())
            existing[key] = (cat, p)
    
    added = 0
    updated = 0
    price_updates = 0
    
    for part in new_parts:
        key = (part['name'].lower().strip(), part['manufacturer'].lower().strip())
        category = part.pop('category', 'receivers')
        
        if key in existing:
            existing_cat, existing_part = existing[key]
            changed = False
            
            # Fill missing fields
            for field in ['link', 'image_file', 'description']:
                if part.get(field) and not existing_part.get(field):
                    existing_part[field] = part[field]
                    changed = True
            
            # Add RDQ price as comparison
            if part.get('approx_price') and part['approx_price'] > 0:
                if 'price_comparison' not in existing_part:
                    existing_part['price_comparison'] = {}
                existing_part['price_comparison']['rdq'] = part['approx_price']
                price_updates += 1
            
            if changed:
                updated += 1
        else:
            if category not in db['components']:
                db['components'][category] = []
            db['components'][category].append(part)
            existing[key] = (category, part)
            added += 1
    
    print(f"\n  Results: {added} added, {updated} enriched, {price_updates} price comparisons")
    
    if not dry_run:
        with open(db_path, 'w') as f:
            json.dump(db, f, indent=2)
        print(f"  Written to {db_path}")
    else:
        print("  DRY RUN — not writing")
    
    return added, updated, price_updates


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Mine RaceDayQuads catalog')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    
    db_path = os.path.join(os.path.dirname(__file__), '..', '..', 
                           'DroneClear Components Visualizer', 'forge_database.json')
    
    all_new = []
    for collection_path in COLLECTION_URLS:
        # Extract collection name
        col_name = collection_path.split('/collections/')[1].split('/')[0]
        forge_cat = COLLECTION_MAP.get(col_name, 'receivers')
        
        print(f"\n{'='*50}")
        print(f"Collection: {col_name} → {forge_cat}")
        print(f"{'='*50}")
        
        products = fetch_collection(collection_path.replace('/products.json', ''))
        
        for p in products:
            entry = shopify_to_forge(p, forge_cat)
            all_new.append(entry)
    
    print(f"\n{'='*50}")
    print(f"Total: {len(all_new)} products from RDQ")
    print(f"{'='*50}")
    
    if all_new:
        merge_into_db(all_new, db_path, dry_run=args.dry_run)
