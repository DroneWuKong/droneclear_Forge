#!/usr/bin/env python3
"""
build_intel.py — Intel dedicated Netlify build (uas-intel.com)

Phase 2B-style split for the Intel property: uas-intel.com becomes
its own Netlify site instead of a vanity alias on forgeprole. Same
pattern as build_patterns_pro.py — zero code duplication, delegates
to build_static.build() after overriding the module-level globals.

Pages shipped:
  - /intel/               Intel hub (intel-home.html)
  - /intel/feed/          Live intel feed (intel.html)
  - /intel-commercial/    Commercial intel
  - /intel-defense/       Defense intel
  - /intel-dfr/           DFR intel
  - /intel-financial/     Financial intel
  - /industry/            Industry tracker
  - /tracker/             Contract tracker
  - /timeline/            Timeline
  - /hub/                 UAS- cross-domain landing hub
  - /pro/                 Subscription / access code (for gated tiers)
  - /admin/               Admin
  - /analytics/           Analytics dashboard
  - /report/              Compliance report
  - /terms/, /privacy/    Legal

Excludes everything else (browse, builder, platforms, compare, ...).
Those stay on uas-forge.com via the main build_static.py.

Netlify setup for the uas-intel site (dashboard or via this repo):
    Repository:        DroneWuKong/droneclear_Forge
    Base directory:    (empty — repo root)
    Build command:     python3 build_intel.py
    Publish directory: build-intel
    Custom domain:     uas-intel.com

Both the new intel site AND the main forgeprole site read the same
root netlify.toml (the dashboard-configured build command + publish
dir override the [build] section). All redirect rules in
[[redirects]] still apply uniformly.

Why split:
  - SEO: uas-intel.com now has its own dedicated sitemap + robots.txt
  - Independent deploy cadence: intel-only updates don't rebuild Forge
  - Own analytics, own error budget
  - Clean mental model: "intel lives at intel.com, parts live at forge.com"

Rollback: just disable the new Netlify site. The intel pages still
exist in the main forgeprole build (we didn't remove them from PAGES),
so uas-forge.com/intel/ keeps working forever as a grandfather URL.
"""
import os
import sys

# Make the main build script importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_static

# ── Pages to ship on the Intel site ─────────────────────────────────────
# Paths are kept intentionally identical to the forgeprole-hosted ones so
# bookmarked URLs (e.g., uas-forge.com/intel/ ↔ uas-intel.com/intel/) stay
# compatible during the grandfather window. CANONICAL_OVERRIDES in
# build_static.py points all of these at uas-intel.com now.
INTEL_PAGES = {
    # Intel core
    'intel-home.html':     'intel/index.html',
    'intel.html':          'intel/feed/index.html',
    'intel-commercial.html': 'intel-commercial/index.html',
    'intel-defense.html':  'intel-defense/index.html',
    'intel-dfr.html':      'intel-dfr/index.html',
    'intel-financial.html': 'intel-financial/index.html',
    'industry.html':       'industry/index.html',
    'tracker.html':        'tracker/index.html',
    'timeline.html':       'timeline/index.html',
    # Cross-domain landing hub
    'uas-hub.html':        'hub/index.html',
    # Auth / subscription / admin (for gated intel tiers)
    'pro.html':            'pro/index.html',
    'admin.html':          'admin/index.html',
    # Supporting pages
    'analytics.html':      'analytics/index.html',
    'report.html':         'report/index.html',
    'terms.html':          'terms/index.html',
    'privacy.html':        'privacy/index.html',
    # Home page — redirect / → /intel/ via netlify.toml rules. If the
    # visitor lands on uas-intel.com root they get sent to the hub.
    # For now, use intel-home.html content at index.html as a fallback.
    # (Actual redirect is in netlify.toml for the new site.)
}

def main():
    # Rewire build_static constants for the Intel site
    build_static.BUILD_DIR = 'build-intel'
    build_static.PAGES     = INTEL_PAGES
    build_static.SITE_URL  = 'https://uas-intel.com'
    build_static.SITE_NAME = 'UAS- Intel — Drone Procurement Intelligence Feed'

    print('=' * 65)
    print('UAS- Intel static site builder')
    print('=' * 65)
    print(f'  SITE_URL:  {build_static.SITE_URL}')
    print(f'  BUILD_DIR: {build_static.BUILD_DIR}')
    print(f'  Pages:     {len(INTEL_PAGES)}')
    print('=' * 65)

    # Delegate to the main build pipeline
    build_static.build()

if __name__ == '__main__':
    main()
