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
    
    # Insert before the first <script src="static/ (our app scripts)
    # But after CDN scripts (phosphor, three.js, codemirror)
    pattern = r'(<script\s+src="static/)'
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
        html = html.replace("fetch('drone_parts_schema_v3.json')", f"fetch('{prefix}static/drone_parts_schema_v3.json')")
    
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
    ]

    for cat in COMPONENT_CATEGORIES:
        json_path = os.path.join(parts_dir, f'{cat}.json')
        if os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            if isinstance(data, list):
                forge_db['components'][cat] = data
                print(f"  {cat}: {len(data)} parts")

    # Replace drone_models from handbook
    models_path = os.path.join(parts_dir, 'drone_models.json')
    if os.path.exists(models_path):
        with open(models_path, 'r', encoding='utf-8') as f:
            models = json.load(f)
        if isinstance(models, list):
            forge_db['drone_models'] = models
            print(f"  drone_models: {len(models)} models")

    # Replace build_guides from handbook
    guides_path = os.path.join(parts_dir, 'build_guides.json')
    if os.path.exists(guides_path):
        with open(guides_path, 'r', encoding='utf-8') as f:
            guides = json.load(f)
        if isinstance(guides, list):
            forge_db['build_guides'] = guides
            print(f"  build_guides: {len(guides)} guides")

    # Merge platforms from drone_database.json (the enriched platform DB)
    platform_db_path = os.path.join(DATA_CLONE_DIR, 'docs', 'database', 'drone_database.json')
    if os.path.exists(platform_db_path):
        with open(platform_db_path, 'r', encoding='utf-8') as f:
            platform_db = json.load(f)
        platforms = platform_db.get('platforms', [])
        if platforms:
            # Merge into drone_models, avoiding duplicates by name
            existing_names = set(m.get('name', '').lower() for m in forge_db.get('drone_models', []))
            added = 0
            max_pid = max((int(m['pid'].split('-')[1]) for m in forge_db.get('drone_models', []) if m.get('pid', '').startswith('DM-')), default=0)
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
                    "description": (p.get('notes', '') or f"{name}. {p.get('category', '').replace('_', ' ').title()} from {p.get('country', '')}.")[:500],
                    "vehicle_type": specs.get('type', 'fixed_wing'),
                    "build_class": "defense" if p.get('combat_proven') else "commercial",
                    "category": p.get('category', ''),
                    "image_file": "",
                    "relations": {},
                    "country": p.get('country', 'Unknown'),
                    "compliance": p.get('compliance', {}),
                    "specs": specs,
                    "combat_proven": p.get('combat_proven', False),
                    "status": p.get('status', 'production'),
                    "tags": p.get('tags', []),
                }
                forge_db.setdefault('drone_models', []).append(entry)
                existing_names.add(name.lower())
                added += 1
            print(f"  platforms: {added} merged from drone_database.json ({len(forge_db['drone_models'])} total)")

    # Write updated forge_database.json
    with open(local_db_path, 'w', encoding='utf-8') as f:
        json.dump(forge_db, f, separators=(',', ':'))

    total_parts = sum(len(v) for v in forge_db['components'].values())
    print(f"\n  forge_database.json updated: {total_parts} parts, {len(forge_db['drone_models'])} models")

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
        html = inject_adapter(html, depth)
        html = fix_nav_links(html, depth)
        
        with open(dst_file, 'w', encoding='utf-8') as f:
            f.write(html)
        
        print(f"  {src_name} → {dst_path}")
    
    # Create Netlify config
    netlify_toml = """[build]
  publish = "build"
  command = "python3 build_static.py"

[[redirects]]
  from = "/builder"
  to = "/builder/"
  status = 301

[[redirects]]
  from = "/academy"
  to = "/academy/"
  status = 301

[[redirects]]
  from = "/audit"
  to = "/audit/"
  status = 301

[[redirects]]
  from = "/library"
  to = "/library/"
  status = 301

[[redirects]]
  from = "/guide"
  to = "/guide/"
  status = 301

[[redirects]]
  from = "/template"
  to = "/template/"
  status = 301
"""
    with open(os.path.join(BUILD_DIR, '..', 'netlify.toml'), 'w') as f:
        f.write(netlify_toml)
    
    # Summary
    total_files = sum(1 for _, _, files in os.walk(BUILD_DIR) for _ in files)
    total_size = sum(os.path.getsize(os.path.join(dp, f)) 
                     for dp, _, files in os.walk(BUILD_DIR) for f in files)
    
    print(f"\n{'═' * 50}")
    print(f"  Forge static build complete")
    print(f"  {total_files} files, {total_size / 1024 / 1024:.1f} MB")
    print(f"  Ready for: netlify deploy --dir=build")
    print(f"{'═' * 50}")


if __name__ == '__main__':
    build()
