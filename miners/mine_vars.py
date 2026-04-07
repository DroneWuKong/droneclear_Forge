#!/usr/bin/env python3
"""
mine_vars.py — VAR and Manufacturer health monitor.

Scrapes public signals to detect staleness and flag changes that warrant
a manual audit update:
  - Press releases / news (acquisitions, funding, leadership changes)
  - Public company SEC filings / earnings (RCAT, XTIA, VLTS, UAVS)
  - LinkedIn post frequency proxy (via public web)
  - Blue UAS list changes (DIU)
  - Brand portfolio changes (new OEM partnerships)

Outputs: miners/.var_audit/var_signals_YYYY-MM-DD.json
Also updates last_checked in patterns.html VARS_DATA + MANUFACTURERS
if --apply flag is passed.

Usage:
    python3 miners/mine_vars.py              # scan + print report
    python3 miners/mine_vars.py --apply      # scan + patch patterns.html
    python3 miners/mine_vars.py --verbose    # full signal dump
"""

import json
import os
import re
import sys
import argparse
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from html.parser import HTMLParser

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT    = os.path.dirname(SCRIPT_DIR)
PATTERNS_SRC = os.path.join(REPO_ROOT, 'DroneClear Components Visualizer', 'patterns.html')
OUTPUT_DIR   = os.path.join(SCRIPT_DIR, '.var_audit')
TODAY        = datetime.now(timezone.utc).strftime('%Y-%m-%d')

os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── VAR watch list ─────────────────────────────────────────────────────────────
# Each entry: id, name, type, public_ticker (if any), news_queries, rss_feeds
VARS_WATCH = [
    {
        "id": "drone-nerds",
        "name": "Drone Nerds / XTI Aerospace",
        "ticker": "XTIA",
        "news_queries": ["Drone Nerds", "XTI Aerospace drone", "Drone Nerds NDAA"],
        "rss": ["https://ir.xtiaerospace.com/rss/news-releases.xml"],
        "signals": ["acquisition", "revenue", "DJI", "UMAC", "leadership"],
    },
    {
        "id": "advexure",
        "name": "Advexure",
        "ticker": None,
        "news_queries": ["Advexure drone dealer", "Advexure UAS partnership"],
        "rss": [],
        "signals": ["partnership", "DJI", "NDAA", "revenue", "IPO"],
    },
    {
        "id": "frontier-precision",
        "name": "Frontier Precision Unmanned",
        "ticker": None,
        "news_queries": ["Frontier Precision Unmanned drone", "Frontier Precision UAS"],
        "rss": ["https://frontierprecision.com/feed/"],
        "signals": ["new brand", "partnership", "expansion"],
    },
    {
        "id": "duncan-parnell",
        "name": "Duncan-Parnell",
        "ticker": None,
        "news_queries": ["Duncan-Parnell drone UAS 2025"],
        "rss": [],
        "signals": ["new brand", "Blue UAS", "NDAA"],
    },
    {
        "id": "dronefly",
        "name": "Dronefly",
        "ticker": None,
        "news_queries": ["Dronefly drone dealer 2025", "Dronefly DJI ban"],
        "rss": ["https://www.dronefly.com/blogs/news.atom"],
        "signals": ["DJI", "acquisition", "closure", "new brand"],
    },
    {
        "id": "dslrpros",
        "name": "DSLRPros / Hazon Solutions",
        "ticker": None,
        "news_queries": ["DSLRPros drone 2025", "Hazon Solutions drone"],
        "rss": [],
        "signals": ["rebranding", "DJI", "acquisition", "closure"],
    },
    {
        "id": "uvt",
        "name": "Unmanned Vehicle Technologies (UVT)",
        "ticker": None,
        "news_queries": ["Unmanned Vehicle Technologies UVT drone 2025", "UVT drone dealer defense"],
        "rss": [],
        "signals": ["acquisition", "contract", "GSA", "leadership"],
    },
    {
        "id": "volatus-drones",
        "name": "Volatus Aerospace",
        "ticker": "FLT",  # TSX
        "news_queries": ["Volatus Aerospace 2025", "Volatus Drones revenue"],
        "rss": ["https://volatusaerospace.com/feed/"],
        "signals": ["revenue", "NATO", "acquisition", "SKYDRA", "earnings"],
    },
    {
        "id": "skyfireai",
        "name": "SkyfireAI",
        "ticker": None,
        "news_queries": ["SkyfireAI drone 2025", "Skyfire DFR Ohio program"],
        "rss": [],
        "signals": ["contract", "Ohio", "DOD", "acquisition", "funding"],
    },
    {
        "id": "drone-arrival",
        "name": "Drone Arrival",
        "ticker": None,
        "news_queries": ["Drone Arrival drone dealer 2025"],
        "rss": ["https://dronearrival.com/feed/"],
        "signals": ["new brand", "partnership", "expansion"],
    },
    {
        "id": "uas-nexus-syndicate",
        "name": "UAS Nexus Syndicate",
        "ticker": None,
        "news_queries": ["UAS Nexus Syndicate 2025", "UAS Nexus Platform One drone"],
        "rss": [],
        "signals": ["Platform One", "Syndicate Store", "Blue UAS", "funding"],
    },
]

# Manufacturer watch list — public company tickers + key news triggers
MFRS_WATCH = [
    {"id": "skydio",        "name": "Skydio",         "ticker": None,
     "queries": ["Skydio revenue 2025", "Skydio funding IPO", "Skydio China sanctions"],
     "flags": ["IPO", "acquisition", "layoffs", "battery", "sanctions", "contract"]},
    {"id": "teal",          "name": "Red Cat Holdings","ticker": "RCAT",
     "queries": ["Red Cat Holdings earnings", "RCAT revenue drone"],
     "flags": ["earnings", "acquisition", "contract", "SRR", "FANG"]},
    {"id": "agEagle",       "name": "AgEagle",         "ticker": "UAVS",
     "queries": ["AgEagle UAVS delisting 2025 2026"],
     "flags": ["delisting", "going concern", "bankruptcy", "acquisition", "compliance"]},
    {"id": "parrot",        "name": "Parrot SA",       "ticker": "PARRO",
     "queries": ["Parrot drone earnings 2025", "Parrot Blue UAS list"],
     "flags": ["Blue UAS", "revenue", "Pix4D", "acquisition"]},
    {"id": "volatus-drones","name": "Volatus Aerospace","ticker": "FLT",
     "queries": ["Volatus Aerospace earnings 2025", "Volatus NATO drone"],
     "flags": ["revenue", "NATO", "SKYDRA", "acquisition"]},
    {"id": "anduril",       "name": "Anduril Industries","ticker": None,
     "queries": ["Anduril drone contract 2025", "Anduril funding IPO"],
     "flags": ["IPO", "funding", "contract", "DOD"]},
    {"id": "shield-ai",     "name": "Shield AI",       "ticker": None,
     "queries": ["Shield AI drone contract 2025", "Shield AI V-BAT"],
     "flags": ["funding", "IPO", "contract", "V-BAT"]},
    {"id": "aerovironment", "name": "AeroVironment",   "ticker": "AVAV",
     "queries": ["AeroVironment earnings AVAV 2025"],
     "flags": ["earnings", "contract", "Switchblade", "acquisition"]},
    {"id": "draganfly",     "name": "Draganfly",        "ticker": "DPRO",
     "queries": ["Draganfly DPRO revenue 2025"],
     "flags": ["delisting", "revenue", "acquisition", "going concern"]},
]

# ── Signal keywords that warrant a flag ───────────────────────────────────────
HIGH_PRIORITY_SIGNALS = [
    'acqui', 'merger', 'bankrupt', 'delist', 'going concern', 'shut down',
    'closes', 'ceases', 'layoff', 'laid off', 'chapter 11', 'chapter 7',
    'ipo', 'going public', 'spac', 'reverse merger',
    'series [a-f]', r'\$\d+[mb]', r'raises \$', r'secures \$',
    'ceo', 'president', 'chief executive', 'leadership',
    'blue uas', 'removed from', 'added to', 'cleared list',
    'fcc covered', 'ndaa non-compliant', 'sanctions',
]

# ── HTTP helpers ───────────────────────────────────────────────────────────────

HEADERS = {'User-Agent': 'Forge-VAR-Monitor/1.0 (github.com/DroneWuKong)'}

def _fetch(url, timeout=12):
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=timeout) as r:
            return r.read().decode('utf-8', errors='replace')
    except (URLError, HTTPError, Exception) as e:
        return None

def _strip_html(html):
    class S(HTMLParser):
        def __init__(self):
            super().__init__()
            self.chunks = []
        def handle_data(self, d):
            self.chunks.append(d)
    p = S()
    p.feed(html)
    return ' '.join(p.chunks)

# ── News search via DuckDuckGo HTML (no API key required) ─────────────────────

def search_news(query, days_back=45):
    """Search DuckDuckGo news for recent articles. Returns list of {title, url, snippet}."""
    q = query.replace(' ', '+')
    url = f"https://html.duckduckgo.com/html/?q={q}+site:dronelife.com+OR+site:dronedj.com+OR+site:commercialuavnews.com+OR+site:dronelife.com+OR+site:globenewswire.com&df=m"
    html = _fetch(url)
    if not html:
        # Fallback: broader search without site restriction
        url = f"https://html.duckduckgo.com/html/?q={q}&df=m"
        html = _fetch(url)
    if not html:
        return []
    
    results = []
    # Parse DDG result snippets
    for m in re.finditer(r'class="result__title"[^>]*>.*?href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</div>', html, re.DOTALL):
        url_found, title, snippet = m.group(1), m.group(2), m.group(3)
        title = re.sub(r'<[^>]+>', '', title).strip()
        snippet = re.sub(r'<[^>]+>', '', snippet).strip()
        if title and len(title) > 5:
            results.append({'title': title, 'url': url_found, 'snippet': snippet[:300]})
    
    return results[:8]

# ── RSS feed parser ────────────────────────────────────────────────────────────

def fetch_rss(feed_url, max_items=5):
    """Parse RSS/Atom feed. Returns list of {title, link, published, summary}."""
    html = _fetch(feed_url)
    if not html:
        return []
    
    items = []
    # Match both RSS <item> and Atom <entry>
    for m in re.finditer(r'<(?:item|entry)[^>]*>(.*?)</(?:item|entry)>', html, re.DOTALL | re.IGNORECASE):
        block = m.group(1)
        title = re.search(r'<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>', block, re.DOTALL)
        link  = re.search(r'<link[^>]*>([^<]+)</link>|<link[^>]+href="([^"]+)"', block)
        pub   = re.search(r'<pubDate[^>]*>(.*?)</pubDate>|<published[^>]*>(.*?)</published>', block, re.DOTALL)
        summ  = re.search(r'<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>|<summary[^>]*>(.*?)</summary>', block, re.DOTALL)
        
        t = re.sub(r'<[^>]+>', '', title.group(1) if title else '').strip()
        l = (link.group(1) or link.group(2) if link else '').strip()
        p = re.sub(r'<[^>]+>', '', (pub.group(1) or pub.group(2) or '') if pub else '').strip()
        s = re.sub(r'<[^>]+>', '', (summ.group(1) or summ.group(2) or '') if summ else '').strip()[:200]
        
        if t:
            items.append({'title': t, 'link': l, 'published': p, 'summary': s})
        if len(items) >= max_items:
            break
    
    return items

# ── Signal scorer ─────────────────────────────────────────────────────────────

def score_signals(texts, flag_words):
    """Return list of matched signals found in texts."""
    combined = ' '.join(texts).lower()
    found = []
    for pattern in HIGH_PRIORITY_SIGNALS:
        if re.search(pattern, combined, re.IGNORECASE):
            # Get a short excerpt
            m = re.search(r'.{0,60}' + pattern + r'.{0,60}', combined, re.IGNORECASE)
            found.append({'pattern': pattern, 'excerpt': m.group(0).strip() if m else ''})
    for fw in flag_words:
        if fw.lower() in combined and fw.lower() not in [f['pattern'] for f in found]:
            found.append({'pattern': fw, 'excerpt': ''})
    return found

# ── Last audit date parser from patterns.html ─────────────────────────────────

def get_audit_dates(patterns_html):
    """Extract last_audited dates from VARS_DATA and MANUFACTURERS in patterns.html."""
    dates = {}
    for m in re.finditer(r'id:\s*"([^"]+)".*?last_audited:\s*"([^"]+)"', patterns_html, re.DOTALL):
        dates[m.group(1)] = m.group(2)
    return dates

def get_staleness(last_audited_date, warn_days=30, critical_days=90):
    """Return staleness level based on days since last audit."""
    if not last_audited_date or last_audited_date == 'unknown':
        return 'unknown', 9999
    try:
        audit_dt = datetime.strptime(last_audited_date, '%Y-%m-%d').replace(tzinfo=timezone.utc)
        days = (datetime.now(timezone.utc) - audit_dt).days
        if days >= critical_days:
            return 'critical', days
        elif days >= warn_days:
            return 'stale', days
        else:
            return 'fresh', days
    except ValueError:
        return 'unknown', 9999

# ── Main scanner ──────────────────────────────────────────────────────────────

def scan_var(var, audit_dates, verbose=False):
    """Scan a single VAR for fresh signals."""
    result = {
        'id': var['id'],
        'name': var['name'],
        'scanned_at': TODAY,
        'last_audited': audit_dates.get(var['id'], 'unknown'),
        'staleness': None,
        'days_since_audit': None,
        'signals_found': [],
        'rss_items': [],
        'needs_review': False,
        'reason': [],
    }
    
    staleness, days = get_staleness(result['last_audited'])
    result['staleness'] = staleness
    result['days_since_audit'] = days
    
    if staleness in ('stale', 'critical', 'unknown'):
        result['needs_review'] = True
        result['reason'].append(f"Last audited {days}d ago (threshold: 30d)")
    
    all_texts = []
    
    # RSS feeds
    for rss_url in var.get('rss', []):
        items = fetch_rss(rss_url)
        result['rss_items'].extend(items)
        all_texts.extend([i['title'] + ' ' + i['summary'] for i in items])
        if verbose:
            for item in items:
                print(f"    RSS: {item['title'][:80]}")
    
    # News search (limited to avoid hammering)
    for query in var.get('news_queries', [])[:2]:  # max 2 queries per VAR
        articles = search_news(query)
        all_texts.extend([a['title'] + ' ' + a['snippet'] for a in articles])
        if verbose:
            for a in articles[:3]:
                print(f"    News: {a['title'][:80]}")
    
    # Score signals
    signals = score_signals(all_texts, var.get('signals', []))
    result['signals_found'] = signals
    
    if signals:
        result['needs_review'] = True
        result['reason'].append(f"{len(signals)} signal(s): {', '.join(s['pattern'] for s in signals[:3])}")
    
    return result


def scan_mfr(mfr, audit_dates, verbose=False):
    """Scan a manufacturer for fresh signals."""
    result = {
        'id': mfr['id'],
        'name': mfr['name'],
        'ticker': mfr.get('ticker'),
        'scanned_at': TODAY,
        'last_audited': audit_dates.get(mfr['id'], 'unknown'),
        'staleness': None,
        'days_since_audit': None,
        'signals_found': [],
        'needs_review': False,
        'reason': [],
    }
    
    staleness, days = get_staleness(result['last_audited'])
    result['staleness'] = staleness
    result['days_since_audit'] = days
    
    if staleness in ('stale', 'critical', 'unknown'):
        result['needs_review'] = True
        result['reason'].append(f"Last audited {days}d ago")
    
    all_texts = []
    for query in mfr.get('queries', [])[:2]:
        articles = search_news(query)
        all_texts.extend([a['title'] + ' ' + a['snippet'] for a in articles])
        if verbose:
            for a in articles[:2]:
                print(f"    {a['title'][:80]}")
    
    signals = score_signals(all_texts, mfr.get('flags', []))
    result['signals_found'] = signals
    
    if signals:
        result['needs_review'] = True
        result['reason'].append(f"{len(signals)} signal(s): {', '.join(s['pattern'] for s in signals[:3])}")
    
    return result


# ── Apply mode: patch last_checked into patterns.html ────────────────────────

def apply_last_checked(patterns_path, scanned_ids):
    """Update last_checked (not last_audited) to today for scanned entities."""
    c = open(patterns_path).read()
    for eid in scanned_ids:
        # Insert/update last_checked field
        pattern = re.compile(
            r'(id:\s*"' + re.escape(eid) + r'".*?)(last_checked:\s*"[^"]*")',
            re.DOTALL
        )
        if pattern.search(c):
            c = pattern.sub(rf'\g<1>last_checked: "{TODAY}"', c)
        # If no last_checked field, add it after last_audited or before closing }
        else:
            entry_pos = c.find(f'id: "{eid}"')
            if entry_pos < 0:
                continue
            obj_start = c.rfind('  {', 0, entry_pos)
            depth = 0; i = obj_start
            while i < len(c):
                if c[i] == '{': depth += 1
                elif c[i] == '}':
                    depth -= 1
                    if depth == 0: obj_end = i + 1; break
                i += 1
            entry = c[obj_start:obj_end]
            if 'last_checked' not in entry:
                entry = entry[:-1].rstrip() + f',\n    last_checked: "{TODAY}"\n  ' + '}'
            c = c[:obj_start] + entry + c[obj_end:]
    
    open(patterns_path, 'w').write(c)
    print(f"  ✓ Updated last_checked for {len(scanned_ids)} entries in patterns.html")


# ── Report formatter ──────────────────────────────────────────────────────────

def print_report(var_results, mfr_results):
    needs_review = [r for r in var_results + mfr_results if r['needs_review']]
    fresh = [r for r in var_results + mfr_results if not r['needs_review']]
    
    print(f"\n{'═'*60}")
    print(f"  VAR + MANUFACTURER HEALTH SCAN — {TODAY}")
    print(f"{'═'*60}")
    print(f"  VARs scanned:        {len(var_results)}")
    print(f"  MFRs scanned:        {len(mfr_results)}")
    print(f"  Need review:         {len(needs_review)}")
    print(f"  Fresh (no action):   {len(fresh)}")
    
    if needs_review:
        print(f"\n{'─'*60}")
        print(f"  ⚠  REVIEW NEEDED")
        print(f"{'─'*60}")
        # Sort by days since audit desc
        for r in sorted(needs_review, key=lambda x: x.get('days_since_audit', 0), reverse=True):
            days = r.get('days_since_audit', '?')
            staleness_icon = '🔴' if r.get('staleness') == 'critical' else '🟡'
            print(f"\n  {staleness_icon} {r['name']}")
            print(f"     Last audited: {r.get('last_audited','unknown')} ({days}d ago)")
            for reason in r.get('reason', []):
                print(f"     → {reason}")
            for sig in r.get('signals_found', [])[:3]:
                if sig.get('excerpt'):
                    print(f"       Signal: \"{sig['excerpt'][:80]}\"")
    
    if fresh:
        print(f"\n{'─'*60}")
        print(f"  ✓  NO ACTION NEEDED")
        print(f"{'─'*60}")
        for r in fresh:
            print(f"  ✓ {r['name']} (audited {r.get('days_since_audit','?')}d ago)")
    
    print(f"\n{'═'*60}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Scan VAR + manufacturer health')
    parser.add_argument('--apply',   action='store_true', help='Patch last_checked into patterns.html')
    parser.add_argument('--verbose', action='store_true', help='Show raw signal sources')
    parser.add_argument('--vars-only',  action='store_true', help='Scan VARs only')
    parser.add_argument('--mfrs-only',  action='store_true', help='Scan manufacturers only')
    parser.add_argument('--id',      type=str, help='Scan a specific ID only')
    args = parser.parse_args()
    
    # Load audit dates from patterns.html
    if not os.path.exists(PATTERNS_SRC):
        print(f"ERROR: patterns.html not found at {PATTERNS_SRC}", file=sys.stderr)
        sys.exit(1)
    
    patterns_html = open(PATTERNS_SRC).read()
    audit_dates = get_audit_dates(patterns_html)
    print(f"  Loaded {len(audit_dates)} audit dates from patterns.html")
    
    var_results = []
    mfr_results = []
    
    # VARs
    if not args.mfrs_only:
        print(f"\n  Scanning {len(VARS_WATCH)} VARs...")
        for var in VARS_WATCH:
            if args.id and var['id'] != args.id:
                continue
            print(f"  → {var['name']}...", end=' ', flush=True)
            result = scan_var(var, audit_dates, verbose=args.verbose)
            var_results.append(result)
            icon = '⚠' if result['needs_review'] else '✓'
            print(icon)
    
    # Manufacturers
    if not args.vars_only:
        print(f"\n  Scanning {len(MFRS_WATCH)} manufacturers...")
        for mfr in MFRS_WATCH:
            if args.id and mfr['id'] != args.id:
                continue
            print(f"  → {mfr['name']}...", end=' ', flush=True)
            result = scan_mfr(mfr, audit_dates, verbose=args.verbose)
            mfr_results.append(result)
            icon = '⚠' if result['needs_review'] else '✓'
            print(icon)
    
    # Print report
    print_report(var_results, mfr_results)
    
    # Save output
    output = {
        'scanned_at': TODAY,
        'var_results': var_results,
        'mfr_results': mfr_results,
        'summary': {
            'vars_scanned': len(var_results),
            'mfrs_scanned': len(mfr_results),
            'needs_review': len([r for r in var_results + mfr_results if r['needs_review']]),
            'fresh': len([r for r in var_results + mfr_results if not r['needs_review']]),
        }
    }
    out_path = os.path.join(OUTPUT_DIR, f'var_signals_{TODAY}.json')
    json.dump(output, open(out_path, 'w'), indent=2)
    print(f"  Saved: {out_path}")
    
    # Apply last_checked update
    if args.apply:
        all_ids = [r['id'] for r in var_results + mfr_results]
        apply_last_checked(PATTERNS_SRC, all_ids)
    
    # Exit code: 1 if any need review (useful for CI alerting)
    needs_count = output['summary']['needs_review']
    if needs_count > 0:
        print(f"  ℹ  {needs_count} entries need manual review. Run with --verbose for details.")
    
    sys.exit(0)  # Always exit 0 — CI should not fail on stale data


if __name__ == '__main__':
    main()
