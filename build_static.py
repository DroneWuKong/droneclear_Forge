#!/usr/bin/env python3
"""
Forge Static Site Builder

Builds static HTML pages for Netlify deployment from source files.
- Clones drone-integration-handbook repo for canonical parts-db data
- Assembles forge_database.json from handbook JSON files + local industry data
- Strips {% load static %} and {% static 'file' %} template tags
- Injects forge-static-adapter.js before any app scripts
- Copies all assets to a build/ directory ready for Netlify
"""

import os
import re
import shutil
import json
import subprocess

SRC_DIR = 'DroneClear Components Visualizer'
BUILD_DIR = 'build'

# Pages to process
PAGES = {
    'index.html': 'builder/index.html',      # /builder/
    'mission-control.html': 'index.html',      # / (home — The Bench)
    'academy.html': 'academy/index.html',
    'audit.html': 'audit/index.html',
    'editor.html': 'library/index.html',
    'guide.html': 'guide/index.html',
    'template.html': 'template/index.html',
    'platforms.html': 'platforms/index.html',
    'browse.html': 'browse/index.html',
    'analytics.html': 'analytics/index.html',
    'contribute.html': 'contribute/index.html',
    'slam-selector.html': 'slam/index.html',
    'slam-guide.html': 'slam-guide/index.html',
    'openhd-guide.html': 'openhd-guide/index.html',
    'mesh-guide.html': 'mesh-guide/index.html',
    'tak-guide.html': 'tak-guide/index.html',
    'ai-guide.html': 'ai-guide/index.html',
    'cuas-guide.html': 'cuas-guide/index.html',
    'swarm-guide.html': 'swarm-guide/index.html',
    'swarm-selector.html': 'swarm/index.html',
    'guides-hub.html': 'guides/index.html',
    'fc-firmware-guide.html': 'fc-firmware-guide/index.html',
    'compliance.html': 'compliance/index.html',
    'compare.html': 'compare/index.html',
    'cost.html': 'cost/index.html',
    'intel-home.html': 'intel/index.html',
    'intel.html': 'intel/feed/index.html',
    'vault.html': 'vault/index.html',
    'troubleshoot.html': 'troubleshoot/index.html',  # Unlisted — no nav links
    'industry.html': 'industry/index.html',
    'intel-defense.html': 'intel-defense/index.html',
    'intel-dfr.html': 'intel-dfr/index.html',
    'intel-financial.html': 'intel-financial/index.html',
    'intel-commercial.html': 'intel-commercial/index.html',
    'payload-compare.html': 'payload-compare/index.html',
    'stack-builder.html': 'stack-builder/index.html',
    'tools.html': 'tools/index.html',
    'wingman.html': 'wingman/index.html',
    'pro.html': 'pro/index.html',
    'admin.html': 'admin/index.html',
    'start.html': 'start/index.html',
    'report.html': 'report/index.html',
    'waiver.html': 'waiver/index.html',
    'terms.html': 'terms/index.html',
    'privacy.html': 'privacy/index.html',
    'pid-tuning.html': 'pid-tuning/index.html',
    'patterns.html': 'patterns/index.html',
    'brief.html': 'brief/index.html',
    'patterns-home.html': 'patterns-home/index.html',
    'tools-home.html': 'tools-home/index.html',
    'tracker.html': 'tracker/index.html',
    'grants.html': 'grants/index.html',
    'regs.html': 'regs/index.html',
    'verify.html': 'verify/index.html',
}

# Static assets to copy (JS, CSS, JSON, images)
STATIC_EXTENSIONS = {'.js', '.css', '.json', '.png', '.jpg', '.svg', '.ico', '.gif', '.webp'}


def strip_django_tags(html):
    """Remove Django template tags and convert to plain HTML paths."""
    # Remove {% load static %}
    html = re.sub(r'\{%\s*load\s+static\s*%\}\s*\n?', '', html)
    
    # Replace {% static 'file.ext' %} and {% static "file.ext" %} with relative path
    html = re.sub(r"\{%\s*static\s+'([^']+)'\s*%\}", r'static/\1', html)
    html = re.sub(r'\{%\s*static\s+"([^"]+)"\s*%\}', r'static/\1', html)
    
    # Replace {{ dc_version }} with static version string
    html = re.sub(r'\{\{\s*dc_version\s*\}\}', 'Forge v1.0', html)
    
    # Remove any remaining {{ ... }} template variables (replace with empty)
    html = re.sub(r'\{\{[^}]+\}\}', '', html)
    
    # Remove any remaining {% ... %} template tags
    html = re.sub(r'\{%[^%]+%\}', '', html)
    
    return html


def inject_adapter(html, depth=0):
    """Inject forge-static-adapter.js before the first app <script> tag."""
    prefix = '../' * depth if depth > 0 else ''
    adapter_tag = f'    <script src="{prefix}static/forge-static-adapter.js"></script>\n'
    
    # Insert before the first local app <script> (static/ or ../static/)
    # But after CDN scripts (phosphor, three.js, codemirror)
    pattern = r'(<script\s+src="(?:\.\./)*static/)'
    match = re.search(pattern, html)
    if match:
        pos = match.start()
        html = html[:pos] + adapter_tag + html[pos:]
    else:
        # Fallback: insert before </body>
        html = html.replace('</body>', adapter_tag + '</body>')
    
    return html


def fix_paths(html, depth=0):
    """Fix static asset paths for the nested directory structure."""
    prefix = '../' * depth if depth > 0 else ''
    
    if depth > 0:
        # Fix CSS/JS/JSON references: static/file.ext → ../static/file.ext
        html = re.sub(r'(href|src)="static/', rf'\1="{prefix}static/', html)
        html = re.sub(r"(href|src)='static/", rf"\1='{prefix}static/", html)
        # Fix fetch calls to static JSON
        html = html.replace("fetch('forge_database.json')", f"fetch('{prefix}static/forge_database.json')")
        html = html.replace("fetch('forge_intel.json')", f"fetch('{prefix}static/forge_intel.json')")
        html = html.replace("fetch('forge_troubleshooting.json')", f"fetch('{prefix}static/forge_troubleshooting.json')")
        html = html.replace("fetch('intel_articles.json')", f"fetch('{prefix}static/intel_articles.json')")
        html = html.replace("fetch('intel_companies.json')", f"fetch('{prefix}static/intel_companies.json')")
        html = html.replace("fetch('intel_platforms.json')", f"fetch('{prefix}static/intel_platforms.json')")
        html = html.replace("fetch('intel_programs.json')", f"fetch('{prefix}static/intel_programs.json')")
        html = html.replace("fetch('intel_programs.json')", f"fetch('{prefix}static/intel_programs.json')")
        html = html.replace("fetch('drone_parts_schema_v3.json')", f"fetch('{prefix}static/forge_database.json')")
        # Master DB files
        html = html.replace("fetch('../data/defense/defense_master.json')", f"fetch('{prefix}static/defense_master.json')")
        html = html.replace("fetch('../data/commercial/commercial_master.json')", f"fetch('{prefix}static/commercial_master.json')")
        html = html.replace("fetch('../data/dfr/dfr_master.json')", f"fetch('{prefix}static/dfr_master.json')")
        # PIE files
        html = html.replace("fetch('pie_flags.json')", f"fetch('{prefix}static/pie_flags.json')")
        html = html.replace("fetch('solicitations.json')", f"fetch('{prefix}static/solicitations.json')")
        html = html.replace("fetch('miner_registry.json')", f"fetch('{prefix}static/miner_registry.json')")
        html = html.replace("fetch('/static/gap_analysis_latest.json')", f"fetch('{prefix}static/gap_analysis_latest.json')")
        html = html.replace("fetch('pie_predictions.json')", f"fetch('{prefix}static/pie_predictions.json')")
        html = html.replace("fetch('pie_brief.json')", f"fetch('{prefix}static/pie_brief.json')")
        html = html.replace("fetch('pie_weekly.json')", f"fetch('{prefix}static/pie_weekly.json')")
        html = html.replace("fetch('forge_firmware_configs.json')", f"fetch('{prefix}static/forge_firmware_configs.json')")
        html = html.replace("fetch('forge_firmware_versions.json')", f"fetch('{prefix}static/forge_firmware_versions.json')")
        html = html.replace("fetch('forge_incompatibilities.json')", f"fetch('{prefix}static/forge_incompatibilities.json')")
        html = html.replace("fetch('forge_orqa_configs.json')", f"fetch('{prefix}static/forge_orqa_configs.json')")
    
    # Fix nav links to use clean URLs
    html = html.replace('href="/"', 'href="/"')
    
    return html


def fix_nav_links(html, depth=0):
    """Update navigation links to use the static site structure."""
    prefix = '../' * depth if depth > 0 else ''
    
    replacements = {
        "href=\"/\"": f'href="{prefix or "/"}"',
        "href=\"/builder/\"": f'href="{prefix}builder/"',
        "href=\"/library/\"": f'href="{prefix}library/"',
        "href=\"/template/\"": f'href="{prefix}template/"',
        "href=\"/guide/\"": f'href="{prefix}guide/"',
        "href=\"/audit/\"": f'href="{prefix}audit/"',
        "href=\"/academy/\"": f'href="{prefix}academy/"',
        "window.location.href = '/'": f"window.location.href = '{prefix or '/'}'",
    }
    
    for old, new in replacements.items():
        html = html.replace(old, new)
    
    return html


# ═══════════════════════════════════════════════════════════════════════════
# SEO — Meta tags, Open Graph, Twitter Cards, Sitemap, robots.txt
# ═══════════════════════════════════════════════════════════════════════════

SITE_URL = 'https://nvmilldoitmyself.com'
SITE_NAME = 'Forge — Drone Integration Handbook'

# SEO metadata per page: (title, description, keywords)
SEO_META = {
    'mission-control.html': (
        'Forge — Drone Build Planner & Intelligence Platform',
        'Browse 3,500+ vetted drone parts, validate build compatibility, assemble step-by-step guides, and access defense intelligence. The interactive companion to the Drone Integration Handbook.',
        'drone build planner, FPV parts database, drone compatibility, NDAA compliant drones, Blue UAS, drone components',
    ),
    'index.html': (
        'Model Builder — Forge Drone Build Planner',
        'Assemble drone builds from 3,500+ vetted parts with real-time 12-check compatibility validation. Flight controllers, ESCs, motors, frames, and more.',
        'drone model builder, FPV build tool, drone parts compatibility, flight controller selector',
    ),
    'wingman.html': (
        'Wingman AI — Drone Troubleshooter & Wiring Analyzer',
        'AI-powered FPV drone troubleshooter. Upload photos for wiring analysis, get PID tuning help, firmware guidance, and real-time web search. Powered by Gemini.',
        'drone troubleshooter AI, FPV wiring analyzer, Betaflight help, drone repair assistant, PID tuning AI',
    ),
    'pid-tuning.html': (
        'PID Tuning Tool — Blackbox FFT Spectral Analysis & Calculator',
        'Interactive PID calculator with Blackbox FFT spectral analysis, symptom diagnostic, filter advisor, and AI tune advisor. Betaflight CLI generator with session logging.',
        'PID tuning calculator, Betaflight PID, Blackbox FFT analysis, drone filter tuning, propwash fix, D-term noise',
    ),
    'tools.html': (
        'RF Tools & Calculators — FPV Channel Planner, Range Estimator',
        'FPV channel planner, harmonics calculator, range estimator, Fresnel zone, dipole antenna length, VTX unlocker, and FC target matcher.',
        'FPV channel planner, RF calculator, drone range estimator, VTX frequency, antenna calculator',
    ),
    'platforms.html': (
        'Drone Platforms Database — 219 Defense & Commercial UAS',
        'Searchable database of 219 drone platforms with specs, compliance status, country of origin, and Blue UAS certification. Filter by NDAA, propulsion, payload.',
        'drone platforms database, Blue UAS list, NDAA compliant drones, military drones, commercial UAS database',
    ),
    'compliance.html': (
        'Drone Compliance Dashboard — NDAA, Blue UAS, ITAR Status',
        'Check NDAA 848 compliance, Blue UAS certification, ITAR restrictions, and country-of-origin status for all drone platforms. Traffic-light compliance tiers.',
        'NDAA drone compliance, Blue UAS cleared drones, drone ITAR, drone procurement compliance',
    ),
    'compare.html': (
        'Drone Platform Compare — Side-by-Side Spec Comparison',
        'Compare 2-3 drone platforms side by side. Specs, compliance, flight time, payload, thermal cameras, and MAVLink support with best/worst highlighting.',
        'drone comparison tool, compare drone specs, platform comparison, UAS specifications',
    ),
    'intel-home.html': (
        'Intel — UAS Intelligence Hub',
        'Defense news, industry funding, platform intelligence and analytics across the UAS ecosystem.',
        'drone intelligence, UAS news, defense drone news',
    ),
    'intel.html': (
        'Intel Feed — Live Defense & Drone Industry News',
        'Curated defense drone news from DefenseScoop, Defense News, Breaking Defense, and The War Zone. Real-time feed with defense, financial, and commercial categories.',
        'drone defense news, UAS industry news, defense drone contracts, drone market intelligence',
    ),
    'industry.html': (
        'Industry Intelligence — Drone Funding, Contracts & Market Data',
        'Curated funding rounds, defense contracts, government grants, and market data for the drone industry. Hand-verified from the Forge data pipeline.',
        'drone industry intelligence, UAS funding, defense drone contracts, drone market data',
    ),
    'slam-guide.html': (
        'SLAM Integration Guide — Visual Odometry for Drones',
        'Complete guide to SLAM integration on drones. ORB-SLAM3, VINS-Fusion, Kimera, and hardware selection.',
        'drone SLAM guide, visual odometry drone, ORB-SLAM3 drone, VINS-Fusion integration',
    ),
    'slam-selector.html': (
        'SLAM Stack Selector — Choose the Right SLAM for Your Drone',
        'Interactive selector for SLAM stacks based on your drone, compute platform, sensors, and use case.',
        'SLAM selector, drone SLAM comparison, visual SLAM for drones, LiDAR SLAM',
    ),
    'swarm-guide.html': (
        'Drone Swarm Integration Guide — Multi-Agent Coordination',
        'Technical guide to drone swarm coordination. Communication protocols, formation control, task allocation, and hardware.',
        'drone swarm guide, multi-drone coordination, swarm communication, drone formation control',
    ),
    'swarm-selector.html': (
        'Swarm Stack Selector — Drone Swarm Architecture Planner',
        'Interactive selector for drone swarm communication and coordination stacks.',
        'drone swarm selector, swarm stack, multi-drone architecture',
    ),
    'tak-guide.html': (
        'TAK Integration Guide — ATAK/WinTAK for Drone Operations',
        'Integrate drones with Team Awareness Kit. ATAK, WinTAK, TAK Server setup, CoT format, and video streaming.',
        'TAK drone integration, ATAK drone, WinTAK UAS, CoT drone, tactical drone feed',
    ),
    'mesh-guide.html': (
        'Mesh Radio Integration Guide — Silvus, Doodle Labs, Rajant',
        'Guide to mesh radio networks for drones. Silvus StreamCaster, Doodle Labs Helix, Rajant Peregrine integration.',
        'drone mesh radio, Silvus drone, Doodle Labs Helix, mesh network drone, MANET drone',
    ),
    'openhd-guide.html': (
        'OpenHD Integration Guide — Open Source HD FPV Video',
        'Set up OpenHD for low-latency HD digital FPV video on custom drones. Hardware selection and antenna setup.',
        'OpenHD setup guide, open source FPV, HD video drone, digital FPV DIY',
    ),
    'fc-firmware-guide.html': (
        'Flight Controller Firmware Guide — Betaflight, iNav, ArduPilot, PX4',
        'Complete comparison of drone flight controller firmware. Betaflight for racing, iNav for GPS, ArduPilot for autonomy, PX4 for enterprise.',
        'Betaflight vs iNav, drone firmware comparison, ArduPilot guide, PX4 setup, flight controller firmware',
    ),
    'academy.html': (
        'FPV Academy — Learn Drone Building & Flight',
        'Educational modules for FPV drone building, soldering, firmware configuration, and flight.',
        'FPV drone tutorial, learn to build drone, FPV academy, drone building course',
    ),
    'guide.html': (
        'Build Guide — Step-by-Step Drone Assembly',
        'Step-by-step drone assembly instructions with photo capture, 3D STL viewer, media carousel, and build session tracking.',
        'drone build guide, FPV assembly instructions, drone wiring guide, step by step drone build',
    ),
    'editor.html': (
        'Parts Library — 3,500+ Vetted Drone Components',
        'Browse and search the full parts library with specs, compatibility data, and filtering by category, manufacturer, and voltage.',
        'drone parts library, FPV component database, flight controller database, motor database',
    ),
    'audit.html': (
        'Build Audit — Drone Build Quality Checklist',
        'Immutable event log, build snapshots, SHA-256 photo hashing, and quality control tracking for drone builds.',
        'drone build audit, quality control drone, build verification, drone inspection checklist',
    ),
    'cost.html': (
        'Cost Estimator — Drone Build BOM & Weight Breakdown',
        'Full bill of materials cost and weight breakdown for drone builds. Per-slot pricing and weight distribution.',
        'drone build cost, FPV build budget, drone BOM calculator, parts cost estimator',
    ),
    'troubleshoot.html': (
        'Drone Troubleshooting Database — 52 Common Issues & Fixes',
        'Searchable database of 52 drone troubleshooting entries across 13 categories. Symptoms, causes, and step-by-step fixes.',
        'drone troubleshooting, FPV problems fixes, Betaflight issues, drone repair guide',
    ),
    'cuas-guide.html': (
        'Counter-UAS Guide — Drone Detection & Defeat Systems',
        'Technical guide to Counter-UAS systems. RF detection, radar, EO/IR, electronic warfare, and kinetic defeat.',
        'counter UAS guide, drone detection system, C-UAS, drone defeat, RF drone detection',
    ),
    'guides-hub.html': (
        'Implementation Guides — SLAM, Mesh, TAK, Swarm & More',
        'Technical implementation guides for drone systems: SLAM, mesh networking, TAK integration, swarm coordination, OpenHD, and counter-UAS.',
        'drone implementation guide, SLAM drone, mesh network drone, TAK drone, drone swarm',
    ),
    'ai-guide.html': (
        'AI & Computer Vision Guide for Drones',
        'Integrate AI and computer vision on drones. Object detection, tracking, YOLO, companion computers, and edge inference.',
        'drone AI guide, drone computer vision, YOLO drone, edge AI drone, companion computer',
    ),
    'browse.html': (
        'Browse Components — Full Drone Parts Catalog',
        'Browse the complete catalog of 3,500+ drone components with search, filtering, and detailed specifications.',
        'drone parts catalog, browse FPV parts, drone component search',
    ),
}

DEFAULT_SEO = (
    'Forge — Drone Integration Handbook',
    'Interactive build planner and intelligence platform for the Drone Integration Handbook. 3,500+ parts, 219 platforms, compliance tracking.',
    'drone build planner, FPV parts, drone intelligence platform',
)


def inject_seo(html, src_name, dst_path):
    """Inject meta description, Open Graph, Twitter Card, and canonical URL."""
    title, description, keywords = SEO_META.get(src_name, DEFAULT_SEO)

    clean_path = dst_path.replace('index.html', '')
    canonical = f'{SITE_URL}/{clean_path}'

    seo_tags = f'''
    <!-- SEO -->
    <meta name="description" content="{description}">
    <meta name="keywords" content="{keywords}">
    <link rel="canonical" href="{canonical}">

    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="{SITE_NAME}">
    <meta property="og:title" content="{title}">
    <meta property="og:description" content="{description}">
    <meta property="og:url" content="{canonical}">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{title}">
    <meta name="twitter:description" content="{description}">
'''

    # Update <title> tag
    html = re.sub(r'<title>[^<]*</title>', f'<title>{title}</title>', html)

    # Inject after viewport meta or before </head>
    if '<meta name="viewport"' in html:
        html = html.replace(
            '<meta name="viewport"',
            seo_tags + '    <meta name="viewport"',
            1
        )
    else:
        html = html.replace('</head>', seo_tags + '</head>', 1)

    return html


def generate_sitemap(pages):
    """Generate sitemap.xml from the PAGES dict."""
    from datetime import datetime
    now = datetime.now().strftime('%Y-%m-%d')

    priority_map = {
        'mission-control.html': '1.0',
        'index.html': '0.9', 'platforms.html': '0.9', 'wingman.html': '0.9',
        'pid-tuning.html': '0.8', 'tools.html': '0.8', 'compliance.html': '0.8',
        'intel.html': '0.8', 'industry.html': '0.8',
        'compare.html': '0.7', 'browse.html': '0.7',
    }

    urls = []
    for src_name, dst_path in pages.items():
        clean_path = dst_path.replace('index.html', '')
        url = f'{SITE_URL}/{clean_path}'
        priority = priority_map.get(src_name, '0.5')
        freq = 'weekly' if src_name in priority_map else 'monthly'
        urls.append(f'''  <url>
    <loc>{url}</loc>
    <lastmod>{now}</lastmod>
    <changefreq>{freq}</changefreq>
    <priority>{priority}</priority>
  </url>''')

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(urls)}
</urlset>'''


def generate_robots_txt():
    return f'''User-agent: *
Allow: /

Sitemap: {SITE_URL}/sitemap.xml

Crawl-delay: 1

Disallow: /analytics/
Disallow: /vault/
Disallow: /contribute/
Disallow: /template/
'''


DATA_REPO = 'https://github.com/DroneWuKong/Ai-Project.git'
DATA_CLONE_DIR = '_data_source'


def sync_handbook_data():
    """Clone the Ai-Project repo and assemble forge_database.json from its parts-db."""
    print("═" * 50)
    print("  Syncing data from Ai-Project...")
    print("═" * 50)

    # Clean previous clone
    if os.path.exists(DATA_CLONE_DIR):
        shutil.rmtree(DATA_CLONE_DIR)

    # Build clone URL — use GITHUB_PAT env var for private repo access
    clone_url = DATA_REPO
    pat = os.environ.get('GITHUB_PAT', '')
    if pat:
        clone_url = DATA_REPO.replace('https://', f'https://x-access-token:{pat}@')
        print("  Using GITHUB_PAT for private repo access")
    else:
        print("  WARNING: No GITHUB_PAT set — clone may fail for private repos")

    # Shallow sparse clone — just data/parts-db
    result = subprocess.run(
        ['git', 'clone', '--depth', '1', '--filter=blob:none', '--sparse', clone_url, DATA_CLONE_DIR],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"  WARNING: Could not clone data repo: {result.stderr.strip()}")
        print("  Falling back to local forge_database.json")
        return False

    subprocess.run(
        ['git', '-C', DATA_CLONE_DIR, 'sparse-checkout', 'set', 'data/parts-db', 'docs/database'],
        capture_output=True, text=True
    )

    parts_dir = os.path.join(DATA_CLONE_DIR, 'data', 'parts-db')
    if not os.path.isdir(parts_dir):
        print(f"  WARNING: {parts_dir} not found after clone")
        print("  Falling back to local forge_database.json")
        return False

    # Load existing forge_database.json for industry data (stays local)
    local_db_path = os.path.join(SRC_DIR, 'forge_database.json')
    with open(local_db_path, 'r', encoding='utf-8') as f:
        forge_db = json.load(f)

    # Replace components from handbook
    # Component categories to sync from handbook
    COMPONENT_CATEGORIES = [
        'antennas', 'batteries', 'escs', 'flight_controllers', 'fpv_cameras',
        'frames', 'gps_modules', 'motors', 'propellers', 'receivers',
        'stacks', 'video_transmitters', 'mesh_radios',
        'companion_computers', 'integrated_stacks', 'counter_uas',
        'esad', 'lidar', 'sensors', 'thermal_cameras',
        'c2_datalinks', 'ew_systems', 'navigation_pnt',
        'ai_accelerators', 'ground_control_stations',
    ]

    for cat in COMPONENT_CATEGORIES:
        json_path = os.path.join(parts_dir, f'{cat}.json')
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                # MERGE: handbook data wins for existing entries, but keep local-only entries
                handbook_names = {e.get('name', '').lower() for e in data}
                local_only = [e for e in forge_db['components'].get(cat, [])
                              if e.get('name', '').lower() not in handbook_names]
                forge_db['components'][cat] = data + local_only
                print(f"  {cat}: {len(data)} from handbook + {len(local_only)} local-only = {len(forge_db['components'][cat])}")

    # MERGE drone_models from handbook (don't overwrite local-only entries)
    models_path = os.path.join(parts_dir, 'drone_models.json')
    if os.path.exists(models_path):
        with open(models_path, 'r', encoding='utf-8') as f:
            models = json.load(f)
        if isinstance(models, list):
            handbook_names = {m.get('name', '').lower() for m in models}
            local_only = [m for m in forge_db.get('drone_models', [])
                          if m.get('name', '').lower() not in handbook_names]
            forge_db['drone_models'] = models + local_only
            print(f"  drone_models: {len(models)} from handbook + {len(local_only)} local-only = {len(forge_db['drone_models'])}")
            print(f"  drone_models: {len(models)} models")

    # Replace build_guides from handbook
    guides_path = os.path.join(parts_dir, 'build_guides.json')
    if os.path.exists(guides_path):
        with open(guides_path, 'r', encoding='utf-8') as f:
            guides = json.load(f)
        if isinstance(guides, list):
            forge_db['build_guides'] = guides
            print(f"  build_guides: {len(guides)} guides")

    # Sync platforms from drone_database.json (the enriched platform DB)
    # Replaces industry.platforms wholesale AND merges new entries into drone_models.
    platform_db_path = os.path.join(DATA_CLONE_DIR, 'docs', 'database', 'drone_database.json')
    if os.path.exists(platform_db_path):
        with open(platform_db_path, 'r', encoding='utf-8') as f:
            platform_db = json.load(f)
        platforms = platform_db.get('platforms', [])
        if platforms:
            # 1. Replace industry.platforms wholesale — primary source for /platforms/ page
            forge_db.setdefault('industry', {})['platforms'] = platforms
            print(f"  industry.platforms: {len(platforms)} platforms synced from drone_database.json")

            # 2. Merge into drone_models for builder/compare backward compat
            existing_names = set(m.get('name', '').lower() for m in forge_db.get('drone_models', []))
            added = 0
            max_pid = max(
                (int(m['pid'].split('-')[1]) for m in forge_db.get('drone_models', [])
                 if m.get('pid', '').startswith('DM-')),
                default=0
            )
            for p in platforms:
                name = f"{p.get('manufacturer', '')} {p.get('platform_name', p.get('name', ''))}".strip()
                if name.lower() in existing_names:
                    continue
                max_pid += 1
                specs = p.get('specs', {})
                entry = {
                    "pid": f"DM-{max_pid:04d}",
                    "name": name,
                    "manufacturer": p.get('manufacturer', ''),
                    "description": (p.get('notes', '') or
                                    f"{name}. {p.get('category', '').replace('_', ' ').title()} "
                                    f"from {p.get('country', '')}.")[:500],
                    "vehicle_type": specs.get('type', 'fixed_wing'),
                    "build_class": "defense" if p.get('combat_proven') else "commercial",
                    "category": p.get('category', ''),
                    "image_file": p.get('image_url', ''),
                    "relations": {},
                    "country": p.get('country', 'Unknown'),
                    "compliance": p.get('compliance', {}),
                    "specs": specs,
                    "combat_proven": p.get('combat_proven', False),
                    "status": p.get('status', 'production'),
                    "tags": p.get('tags', []),
                    "industry_data": {
                        "contracts": p.get('contracts', {}),
                        "funding": p.get('funding', {}),
                        "production": p.get('production', {}),
                        "gcs": p.get('gcs', {}),
                        "variants": p.get('variants', []),
                        "manufacturer_hq": p.get('manufacturer_hq', ''),
                        "manufacturer_url": p.get('manufacturer_url', ''),
                        "image_url": p.get('image_url', ''),
                    },
                }
                forge_db.setdefault('drone_models', []).append(entry)
                existing_names.add(name.lower())
                added += 1
            print(f"  drone_models: {added} new entries added ({len(forge_db['drone_models'])} total)")

    # Write updated forge_database.json
    with open(local_db_path, 'w', encoding='utf-8') as f:
        json.dump(forge_db, f, separators=(',', ':'))

    total_parts = sum(len(v) for v in forge_db['components'].values())
    print(f"\n  forge_database.json updated: {total_parts} parts, {len(forge_db['drone_models'])} models")

    # intel_*.json are committed directly into the repo by sync-forge-data.yml
    # Just report what's already there — no network call needed
    for fname in ['articles.json', 'companies.json', 'platforms.json', 'programs.json']:
        src = os.path.join(SRC_DIR, 'intel_' + fname)
        if os.path.exists(src):
            with open(src) as f:
                data = json.load(f)
            count = len(data) if isinstance(data, list) else '?'
            print(f"  intel_{fname}: {count} entries")
        else:
            print(f"  WARNING: {fname} not found in repo — intel pages will be empty")

    # pie_trends.json — synced by pie-pipeline workflow via sync-forge-data
    trends_src = os.path.join(SRC_DIR, 'pie_trends.json')
    if os.path.exists(trends_src):
        with open(trends_src) as f:
            trends_data = json.load(f)
        n_trends = len(trends_data.get('trends', []))
        n_proj   = len(trends_data.get('projections', []))
        print(f"  pie_trends.json: {n_trends} trends, {n_proj} projections")
    else:
        print("  pie_trends.json: not found — trends panel will show empty state (appears after first PIE run)")

    for pf in ['pie_predictions.json', 'llm_predictions.json']:
        src = os.path.join(SRC_DIR, pf)
        if os.path.exists(src):
            with open(src) as f:
                data = json.load(f)
            print(f"  {pf}: {len(data)} predictions")
        else:
            print(f"  {pf}: not found (appears after first PIE+LLM run)")

    # Cleanup
    shutil.rmtree(DATA_CLONE_DIR, ignore_errors=True)
    print("  Data sync complete.\n")
    return True



def build():
    # Step 0: Sync data from handbook repo
    sync_handbook_data()

    # Clean build directory
    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    
    os.makedirs(BUILD_DIR)
    os.makedirs(os.path.join(BUILD_DIR, 'static'))
    
    # Copy static assets
    for fname in os.listdir(SRC_DIR):
        ext = os.path.splitext(fname)[1].lower()
        if ext in STATIC_EXTENSIONS:
            src = os.path.join(SRC_DIR, fname)
            dst = os.path.join(BUILD_DIR, 'static', fname)
            shutil.copy2(src, dst)
    
    print(f"Copied static assets to {BUILD_DIR}/static/")

    # Copy master DB JSON files from data/ dirs into static/
    master_dbs = [
        ('data/defense/defense_master.json', 'defense_master.json'),
        ('data/commercial/commercial_master.json', 'commercial_master.json'),
        ('data/dfr/dfr_master.json', 'dfr_master.json'),
    ]
    for src_rel, dst_name in master_dbs:
        if os.path.exists(src_rel):
            shutil.copy2(src_rel, os.path.join(BUILD_DIR, 'static', dst_name))
            print(f"  Copied {src_rel} -> static/{dst_name}")
        else:
            print(f"  WARNING: {src_rel} not found - {dst_name} missing from build")
    
    # Process HTML pages
    for src_name, dst_path in PAGES.items():
        src_file = os.path.join(SRC_DIR, src_name)
        dst_file = os.path.join(BUILD_DIR, dst_path)
        
        os.makedirs(os.path.dirname(dst_file), exist_ok=True)
        
        with open(src_file, 'r', encoding='utf-8') as f:
            html = f.read()
        
        # Calculate nesting depth for relative paths
        depth = dst_path.count('/')
        
        html = strip_django_tags(html)
        html = fix_paths(html, depth)
        html = inject_seo(html, src_name, dst_path)
        html = inject_adapter(html, depth)
        html = fix_nav_links(html, depth)
        
        with open(dst_file, 'w', encoding='utf-8') as f:
            f.write(html)
        
        print(f"  {src_name} → {dst_path}")
    
    # Generate sitemap.xml
    sitemap = generate_sitemap(PAGES)
    with open(os.path.join(BUILD_DIR, 'sitemap.xml'), 'w') as f:
        f.write(sitemap)
    print(f"  Generated sitemap.xml ({len(PAGES)} URLs)")
    
    # Generate robots.txt
    with open(os.path.join(BUILD_DIR, 'robots.txt'), 'w') as f:
        f.write(generate_robots_txt())
    print(f"  Generated robots.txt")
    
    # Copy service worker to build root (must be at root for scope)
    sw_src = os.path.join(SRC_DIR, 'sw.js')
    if os.path.exists(sw_src):
        shutil.copy2(sw_src, os.path.join(BUILD_DIR, 'sw.js'))
        print(f"  Copied sw.js to build root")
    
    # netlify.toml lives in the repo root — do not overwrite it from the build script.
    # All redirect rules are maintained in the root netlify.toml.
    
    # Summary
    total_files = sum(1 for _, _, files in os.walk(BUILD_DIR) for _ in files)
    total_size = sum(os.path.getsize(os.path.join(dp, f)) 
                     for dp, _, files in os.walk(BUILD_DIR) for f in files)
    
    print(f"\n{'═' * 50}")
    print(f"  Forge static build complete")
    print(f"  {total_files} files, {total_size / 1024 / 1024:.1f} MB")
    print(f"  Ready for: netlify deploy --dir=build")
    print(f"{'═' * 50}")

    # ── Post-build count validation ──
    print(f"\n  Validating data consistency...")
    src_db_path = os.path.join(SRC_DIR, 'forge_database.json')
    build_db_path = os.path.join(BUILD_DIR, 'static', 'forge_database.json')
    if os.path.exists(src_db_path) and os.path.exists(build_db_path):
        with open(src_db_path) as f:
            src_db = json.load(f)
        with open(build_db_path) as f:
            build_db = json.load(f)
        src_parts = sum(len(v) for v in src_db.get('components', {}).values())
        build_parts = sum(len(v) for v in build_db.get('components', {}).values())
        src_models = len(src_db.get('drone_models', []))
        build_models = len(build_db.get('drone_models', []))
        src_cats = len(src_db.get('components', {}))
        build_cats = len(build_db.get('components', {}))

        ok = True
        if src_parts != build_parts:
            print(f"  ⚠ MISMATCH: components {src_parts} (source) vs {build_parts} (build)")
            ok = False
        if src_models != build_models:
            print(f"  ⚠ MISMATCH: drone_models {src_models} (source) vs {build_models} (build)")
            ok = False
        if src_cats != build_cats:
            print(f"  ⚠ MISMATCH: categories {src_cats} (source) vs {build_cats} (build)")
            ok = False
        if ok:
            print(f"  ✓ Counts match: {src_parts} parts, {src_models} models, {src_cats} categories")


if __name__ == '__main__':
    build()
