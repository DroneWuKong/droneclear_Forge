#!/usr/bin/env python3
"""
build_patterns_pro.py — Patterns Pro dedicated Netlify build

Phase 2B of the domain transition: Patterns Pro is its own Netlify site
at uas-patterns.pro, independent deploys, own analytics, own error budget.
Same repo as droneclear_Forge (no code duplication), same `build_static.py`
machinery (read-process-write HTML pipeline), but this entry point only
builds Patterns-related pages and writes to a separate output directory.

Netlify setup for the Patterns Pro site (dashboard, not netlify.toml):
    Repository:        DroneWuKong/droneclear_Forge
    Base directory:    (empty — repo root)
    Build command:     python3 build_patterns_pro.py
    Publish directory: build-patterns
    Custom domain:     uas-patterns.pro

The root netlify.toml is still read by Netlify for both sites, but the
dashboard "Build command" + "Publish directory" fields override the
[build] section, so each site runs its own command and publishes from
its own folder. All redirect rules in [[redirects]] apply to both sites.

Why this approach:
  - Zero code duplication — functions, JS, CSS, and data shared with Forge
  - Independent deploy cadence — Pro ships when Pro ships, Forge when Forge
  - Clean SEO story — uas-patterns.pro has its own sitemap + robots.txt
  - Easy rollback — just disable the Pro site in Netlify, uas-patterns.pro
    aliases back onto the Forge site via the existing netlify.toml rules.
"""
import os
import sys

# Make the main build script importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_static

# ── Pages to ship on the Patterns Pro site ──────────────────────────────
# Everything users need to authenticate, view flags/predictions/brief,
# manage their subscription, and read the T&Cs. Legal pages duplicated
# here because uas-patterns.pro users land on this site, not uas-forge.com.
PATTERNS_PRO_PAGES = {
    # Home — redirects to /patterns/ via the landing rule in netlify.toml
    'patterns-home.html':  'index.html',
    # Core gated dashboards
    'patterns.html':       'patterns/index.html',
    'brief.html':          'brief/index.html',
    'clock.html':          'clock/index.html',
    'ddg.html':            'ddg/index.html',
    # Auth / subscription / admin
    'pro.html':            'pro/index.html',
    'admin.html':          'admin/index.html',
    # UAS- cross-domain landing hub (reachable from uas-patterns.pro/hub/ too)
    'uas-hub.html':        'hub/index.html',
    # Supporting pages
    'analytics.html':      'analytics/index.html',
    'report.html':         'report/index.html',
    'terms.html':          'terms/index.html',
    'privacy.html':        'privacy/index.html',
}

def main():
    # Rewire build_static constants for Pro site
    build_static.BUILD_DIR = 'build-patterns'
    build_static.PAGES     = PATTERNS_PRO_PAGES
    build_static.SITE_URL  = 'https://uas-patterns.pro'
    build_static.SITE_NAME = 'Patterns Pro — UAS Pattern Intelligence'

    print('=' * 65)
    print('Patterns Pro static site builder')
    print('=' * 65)
    print(f'  SITE_URL:  {build_static.SITE_URL}')
    print(f'  BUILD_DIR: {build_static.BUILD_DIR}')
    print(f'  Pages:     {len(PATTERNS_PRO_PAGES)}')
    print('=' * 65)

    # Delegate to the main build pipeline
    build_static.build()

if __name__ == '__main__':
    main()
