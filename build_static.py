#!/usr/bin/env python3
"""
Forge Static Site Builder

Converts the Django-templated HTML pages into pure static HTML for Netlify deployment.
- Strips {% load static %} and {% static 'file' %} template tags
- Injects forge-static-adapter.js before any app scripts
- Copies all assets to a build/ directory ready for Netlify
"""

import os
import re
import shutil

SRC_DIR = 'DroneClear Components Visualizer'
BUILD_DIR = 'build'

# Pages to process
PAGES = {
    'index.html': 'builder/index.html',      # /builder/
    'mission-control.html': 'index.html',      # / (home)
    'academy.html': 'academy/index.html',
    'audit.html': 'audit/index.html',
    'editor.html': 'library/index.html',
    'guide.html': 'guide/index.html',
    'template.html': 'template/index.html',
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


def build():
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
