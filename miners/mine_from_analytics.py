#!/usr/bin/env python3
"""
mine_from_analytics.py — Analytics-driven troubleshooting enrichment

Reads Wingman's centralized analytics to identify:
  1. Most common query categories (what people struggle with)
  2. Queries with no good troubleshooting entry (gaps in the DB)
  3. Recurring questions that need better answers

Then mines the web for solutions and generates new troubleshooting entries.

Pipeline:
  Analytics → Gap Analysis → Web Mining → New TS Entries → Review Queue

Usage:
    # Fetch analytics and identify gaps
    python3 miners/mine_from_analytics.py --analyze

    # Fetch analytics + mine solutions for top gaps
    python3 miners/mine_from_analytics.py --mine

    # Mine solutions for a specific category
    python3 miners/mine_from_analytics.py --mine --category wiring

    # Use local analytics export (instead of fetching from server)
    python3 miners/mine_from_analytics.py --mine --local analytics_export.json

    # Dry run — show what would be mined
    python3 miners/mine_from_analytics.py --mine --dry-run

Environment:
    ANALYTICS_ADMIN_KEY — Admin key for central analytics endpoint
    FORGE_SITE — Site URL (default: https://forgeprole.netlify.app)
"""

import json
import os
import sys
import re
import time
from datetime import datetime
from urllib.request import urlopen, Request
from urllib.error import URLError

# ─── Config ────────────────────────────────────────────────────
ADMIN_KEY = os.environ.get('ANALYTICS_ADMIN_KEY', 'forge-admin-2026')
FORGE_SITE = os.environ.get('FORGE_SITE', 'https://forgeprole.netlify.app')
ANALYTICS_URL = f'{FORGE_SITE}/.netlify/functions/analytics'

TS_DB_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 
    'DroneClear Components Visualizer', 'forge_troubleshooting.json')
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', '.analytics_output')

# Sources to mine for each category
CATEGORY_SOURCES = {
    'wiring': [
        ('Oscar Liang — FPV wiring', 'https://oscarliang.com/fc-wiring/'),
        ('Betaflight Wiki — UART', 'https://betaflight.com/docs/wiki/Serial-Configuration'),
        ('Joshua Bardwell — FC wiring', 'https://www.fpvknowitall.com/fpv-shopping-list-flight-controller/'),
    ],
    'motors': [
        ('Oscar Liang — motor issues', 'https://oscarliang.com/motor-problem-troubleshoot/'),
        ('Betaflight Wiki — motors', 'https://betaflight.com/docs/wiki/Motor-and-Prop-Rotation'),
    ],
    'escs': [
        ('Oscar Liang — ESC', 'https://oscarliang.com/choose-esc/'),
        ('BLHeli_32 troubleshooting', 'https://github.com/bitdump/BLHeli/blob/master/BLHeli_32%20ARM/BLHeli_32%20manual%20ARM%20Rev32.x.pdf'),
    ],
    'video': [
        ('Oscar Liang — VTX guide', 'https://oscarliang.com/fpv-vtx/'),
        ('DJI O3/O4 setup', 'https://oscarliang.com/setup-dji-fpv-system/'),
        ('HDZero guide', 'https://oscarliang.com/hdzero/'),
    ],
    'radio': [
        ('ELRS documentation', 'https://www.expresslrs.org/quick-start/getting-started/'),
        ('Oscar Liang — ELRS guide', 'https://oscarliang.com/expresslrs/'),
        ('TBS Crossfire manual', 'https://www.team-blacksheep.com/tbs-crossfire-manual.pdf'),
    ],
    'gps': [
        ('ArduPilot — GPS setup', 'https://ardupilot.org/copter/docs/common-gps-how-it-works.html'),
        ('iNav — GPS troubleshooting', 'https://github.com/iNavFlight/inav/wiki/GPS-Fix-and-Issues'),
        ('Oscar Liang — GPS rescue', 'https://oscarliang.com/gps-rescue/'),
    ],
    'battery': [
        ('Oscar Liang — LiPo guide', 'https://oscarliang.com/lipo-battery-guide/'),
        ('Battery University — LiPo', 'https://batteryuniversity.com/article/bu-808c-charging-lithium-ion-polymer-lipo'),
    ],
    'firmware': [
        ('Betaflight — Getting Started', 'https://betaflight.com/docs/wiki/Getting-Started'),
        ('ArduPilot — firmware install', 'https://ardupilot.org/copter/docs/common-install-mission-planner.html'),
        ('iNav — flashing', 'https://github.com/iNavFlight/inav/wiki/Flashing'),
    ],
    'compliance': [
        ('Blue UAS list (DIU)', 'https://www.diu.mil/blue-uas-cleared-list'),
        ('NDAA §848 overview', 'https://uavcoach.com/ndaa-compliant-drones/'),
    ],
    'pid': [
        ('Betaflight — PID tuning', 'https://betaflight.com/docs/wiki/PID-Tuning-Guide'),
        ('Oscar Liang — PID tuning', 'https://oscarliang.com/pid-tuning/'),
        ('UAV Tech — Filter tuning', 'https://theuavtech.com/tuning/'),
    ],
    'crash': [
        ('Oscar Liang — post-crash', 'https://oscarliang.com/after-crash-checklist/'),
    ],
    'frame': [
        ('Oscar Liang — frame guide', 'https://oscarliang.com/fpv-frame/'),
    ],
    'build': [
        ('Oscar Liang — build guide', 'https://oscarliang.com/build-fpv-drone/'),
        ('Joshua Bardwell — builds', 'https://www.fpvknowitall.com/'),
    ],
    'orqa': [
        ('Orqa official', 'https://orfrqa.com/'),
    ],
}


# ─── Fetch Analytics ───────────────────────────────────────────
def fetch_central_analytics(days=30):
    """Fetch analytics from the central Netlify endpoint."""
    url = f'{ANALYTICS_URL}?key={ADMIN_KEY}&range={days}'
    try:
        req = Request(url, headers={'User-Agent': 'Forge-Miner/1.0'})
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        print(f'  ⚠ Could not fetch central analytics: {e}')
        return None


def load_local_analytics(path):
    """Load analytics from a local JSON export."""
    with open(path) as f:
        return json.load(f)


# ─── Gap Analysis ──────────────────────────────────────────────
def load_existing_ts():
    """Load existing troubleshooting database."""
    if not os.path.exists(TS_DB_PATH):
        return {'entries': []}
    with open(TS_DB_PATH) as f:
        return json.load(f)


def analyze_gaps(analytics_data):
    """
    Compare analytics query patterns against existing troubleshooting entries.
    Returns ranked list of categories that need more content.
    """
    ts_db = load_existing_ts()
    existing_entries = ts_db.get('entries', [])
    
    # Count existing entries per category
    ts_counts = {}
    for entry in existing_entries:
        cat = entry.get('category', 'general')
        ts_counts[cat] = ts_counts.get(cat, 0) + 1
    
    # Get query category distribution from analytics
    totals = analytics_data.get('totals', {})
    query_cats = totals.get('cats', {})
    total_queries = totals.get('queries', 0)
    
    if not total_queries:
        print('  No analytics data yet. Run Wingman and collect some queries first.')
        return []
    
    # Calculate gap score: high query % but low TS coverage = big gap
    gaps = []
    for cat, query_count in query_cats.items():
        query_pct = round(query_count / total_queries * 100, 1)
        ts_count = ts_counts.get(cat, 0)
        
        # Map analytics categories to TS categories (some differ)
        ts_cat_map = {
            'radio': 'radio_link',
            'battery': 'power',
            'crash': 'crashes',
            'build': 'general',
            'platform': 'general',
        }
        mapped_cat = ts_cat_map.get(cat, cat)
        ts_count = ts_counts.get(mapped_cat, ts_counts.get(cat, 0))
        
        # Gap score: queries weighted against TS coverage
        # High queries + low TS entries = high gap
        if ts_count == 0:
            gap_score = query_count * 3  # No entries at all — critical gap
        elif ts_count < 3:
            gap_score = query_count * 2  # Few entries — significant gap
        else:
            gap_score = query_count / (ts_count + 1)  # Some coverage — diminishing need
        
        gaps.append({
            'category': cat,
            'queries': query_count,
            'query_pct': query_pct,
            'ts_entries': ts_count,
            'gap_score': round(gap_score, 1),
            'priority': 'HIGH' if gap_score > 20 else 'MEDIUM' if gap_score > 5 else 'LOW',
        })
    
    # Sort by gap score
    gaps.sort(key=lambda x: x['gap_score'], reverse=True)
    return gaps


def extract_recent_queries(analytics_data, category=None):
    """Get recent actual queries for a category to understand what people are asking."""
    recent = analytics_data.get('recentQueries', [])
    if category:
        recent = [q for q in recent if q.get('cat') == category]
    return [q.get('q', '') for q in recent[:20]]


# ─── Web Mining ────────────────────────────────────────────────
def fetch_page_text(url, max_chars=15000):
    """Fetch a web page and extract text content."""
    try:
        req = Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Forge-Miner) AppleWebKit/537.36',
        })
        with urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8', errors='replace')
        
        # Strip HTML tags (simple approach)
        text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
        text = re.sub(r'<style[^>]*>.*?</style>', '', html, flags=re.DOTALL)
        text = re.sub(r'<[^>]+>', ' ', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:max_chars]
    except Exception as e:
        print(f'    ⚠ Failed to fetch {url}: {e}')
        return ''


def mine_solutions_for_category(category, queries, dry_run=False):
    """
    Mine the web for troubleshooting content relevant to a category.
    Returns list of potential new troubleshooting entries.
    """
    sources = CATEGORY_SOURCES.get(category, [])
    if not sources:
        print(f'  No sources configured for category: {category}')
        return []
    
    print(f'\n  Mining {len(sources)} sources for [{category}]...')
    if queries:
        print(f'  Sample queries: {queries[:3]}')
    
    mined_entries = []
    
    for source_name, url in sources:
        if dry_run:
            print(f'    [DRY RUN] Would fetch: {source_name} — {url}')
            continue
        
        print(f'    Fetching: {source_name}...')
        text = fetch_page_text(url)
        if not text:
            continue
        
        # Extract potential troubleshooting patterns
        # Look for problem → solution structures
        entries = extract_ts_patterns(text, category, source_name, url)
        mined_entries.extend(entries)
        
        time.sleep(1)  # Rate limiting
    
    return mined_entries


def extract_ts_patterns(text, category, source_name, url):
    """
    Extract troubleshooting patterns from page text.
    Looks for common structures: problem/solution, symptom/fix, 
    numbered steps, FAQ patterns.
    """
    entries = []
    
    # Pattern 1: "Problem: ... Solution: ..."
    problems = re.findall(
        r'(?:problem|issue|error|symptom)[:\s]+(.{30,200}?)(?:solution|fix|resolve|try)[:\s]+(.{30,500})',
        text, re.IGNORECASE
    )
    for symptom, fix in problems:
        entries.append(build_ts_entry(
            title=symptom.strip()[:80],
            category=category,
            symptoms=[symptom.strip()[:200]],
            fixes=[fix.strip()[:500]],
            source=source_name,
            url=url,
        ))
    
    # Pattern 2: "If ... then ..." (conditional fixes)
    conditionals = re.findall(
        r'[Ii]f (?:you|your|the) (.{20,150}?),?\s+(?:then|try|you should|you need to|check) (.{20,300})',
        text
    )
    for condition, action in conditionals[:5]:  # Limit per page
        entries.append(build_ts_entry(
            title=f'{condition.strip()[:60]}',
            category=category,
            symptoms=[condition.strip()[:200]],
            fixes=[action.strip()[:500]],
            source=source_name,
            url=url,
        ))
    
    # Pattern 3: "Common causes:" or "Troubleshooting:" sections
    sections = re.findall(
        r'(?:common\s+(?:causes?|issues?|problems?)|troubleshoot(?:ing)?)[:\s]+(.{50,1000}?)(?:\n\n|$)',
        text, re.IGNORECASE
    )
    for section in sections[:3]:
        # Split bullets
        bullets = re.findall(r'[-•*]\s*(.{20,200})', section)
        if bullets:
            entries.append(build_ts_entry(
                title=f'{category} common issues',
                category=category,
                symptoms=bullets[:4],
                fixes=bullets[4:8] if len(bullets) > 4 else ['See source for detailed steps'],
                source=source_name,
                url=url,
            ))
    
    return entries


def build_ts_entry(title, category, symptoms, fixes, source, url):
    """Build a standardized troubleshooting entry."""
    return {
        'id': f'TS-MINED-{int(time.time())}-{hash(title) % 10000:04d}',
        'title': title,
        'category': category,
        'severity': 'medium',
        'symptoms': symptoms,
        'causes': [f'Identified from {source}'],
        'diagnostics': [f'Reference: {url}'],
        'fixes': fixes,
        'related_parts': [],
        'difficulty': 'intermediate',
        'tags': ['auto-mined', f'source:{source}', f'cat:{category}'],
        'source': {
            'mined_from': url,
            'source_name': source,
            'mined_at': datetime.now().isoformat(),
            'pipeline': 'analytics-driven',
        },
        'status': 'review',  # Needs human review before merging
    }


# ─── Output ────────────────────────────────────────────────────
def save_results(gaps, mined_entries, analytics_data):
    """Save gap analysis and mined entries for review."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    # Save gap analysis
    gap_path = os.path.join(OUTPUT_DIR, f'gap_analysis_{timestamp}.json')
    with open(gap_path, 'w') as f:
        json.dump({
            'generated': datetime.now().isoformat(),
            'total_queries': analytics_data.get('totals', {}).get('queries', 0),
            'total_sessions': analytics_data.get('totals', {}).get('sessions', 0),
            'gaps': gaps,
        }, f, indent=2)
    print(f'\n  Gap analysis saved: {gap_path}')
    
    # Also write to static/ so the analytics page can load it
    static_path = os.path.join(os.path.dirname(__file__), '..', 
        'DroneClear Components Visualizer', 'gap_analysis_latest.json')
    try:
        import shutil
        shutil.copy2(gap_path, static_path)
        print(f'  Copied to static: {static_path}')
        print(f'  → Deploy and it will appear at /static/gap_analysis_latest.json')
    except Exception as e:
        print(f'  Warning: could not copy to static: {e}')
    
    # Save mined entries (review queue)
    if mined_entries:
        mined_path = os.path.join(OUTPUT_DIR, f'mined_entries_{timestamp}.json')
        with open(mined_path, 'w') as f:
            json.dump({
                'meta': {
                    'generated': datetime.now().isoformat(),
                    'count': len(mined_entries),
                    'note': 'REVIEW BEFORE MERGING — auto-mined entries need human verification',
                    'pipeline': 'analytics → gap analysis → web mining → review queue',
                },
                'entries': mined_entries,
            }, f, indent=2)
        print(f'  Mined entries saved: {mined_path} ({len(mined_entries)} entries)')
    
    return gap_path


# ─── Main ──────────────────────────────────────────────────────
def main():
    import argparse
    parser = argparse.ArgumentParser(description='Analytics-driven troubleshooting miner')
    parser.add_argument('--analyze', action='store_true', help='Show gap analysis only')
    parser.add_argument('--mine', action='store_true', help='Mine solutions for top gaps')
    parser.add_argument('--category', help='Mine specific category only')
    parser.add_argument('--local', help='Path to local analytics JSON export')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be mined')
    parser.add_argument('--days', type=int, default=30, help='Days of analytics to analyze')
    parser.add_argument('--top', type=int, default=5, help='Number of top gaps to mine')
    args = parser.parse_args()
    
    if not args.analyze and not args.mine:
        args.analyze = True  # Default to analysis
    
    print('═══ WINGMAN ANALYTICS-DRIVEN MINER ═══\n')
    
    # Step 1: Get analytics data
    if args.local:
        print(f'  Loading local analytics: {args.local}')
        analytics_data = load_local_analytics(args.local)
    else:
        print(f'  Fetching central analytics ({args.days} days)...')
        analytics_data = fetch_central_analytics(args.days)
        if not analytics_data:
            print('  Failed to fetch. Use --local with an exported JSON file instead.')
            sys.exit(1)
    
    totals = analytics_data.get('totals', {})
    print(f'  Total queries: {totals.get("queries", 0)}')
    print(f'  Total sessions: {totals.get("sessions", 0)}')
    print(f'  Image queries: {totals.get("imageQueries", 0)}')
    
    # Step 2: Gap analysis
    print('\n─── GAP ANALYSIS ───')
    gaps = analyze_gaps(analytics_data)
    
    if not gaps:
        print('  No gaps identified (need more analytics data)')
        return
    
    print(f'\n  {"Category":<15} {"Queries":<10} {"% of All":<10} {"TS Entries":<12} {"Gap Score":<12} {"Priority"}')
    print(f'  {"─"*15} {"─"*10} {"─"*10} {"─"*12} {"─"*12} {"─"*8}')
    for g in gaps:
        print(f'  {g["category"]:<15} {g["queries"]:<10} {g["query_pct"]:<10} {g["ts_entries"]:<12} {g["gap_score"]:<12} {g["priority"]}')
    
    # Step 3: Mine solutions (if requested)
    mined_entries = []
    if args.mine:
        print('\n─── MINING SOLUTIONS ───')
        
        if args.category:
            categories = [args.category]
        else:
            # Mine top N gaps
            categories = [g['category'] for g in gaps[:args.top] if g['gap_score'] > 2]
        
        for cat in categories:
            queries = extract_recent_queries(analytics_data, cat)
            entries = mine_solutions_for_category(cat, queries, dry_run=args.dry_run)
            mined_entries.extend(entries)
            print(f'    → {len(entries)} entries mined for [{cat}]')
    
    # Step 4: Save results
    save_results(gaps, mined_entries, analytics_data)
    
    print(f'\n═══ COMPLETE ═══')
    if mined_entries:
        print(f'  {len(mined_entries)} entries ready for review')
        print(f'  Review them in: {OUTPUT_DIR}/')
        print(f'  After review, merge approved entries into forge_troubleshooting.json')
    else:
        print(f'  Run with --mine to generate troubleshooting entries for top gaps')


if __name__ == '__main__':
    main()
