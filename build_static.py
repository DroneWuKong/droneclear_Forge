#!/usr/bin/env python3
"""
Forge Static Site Builder

Builds static HTML pages for Netlify deployment from source files.
- Clones drone-integration-handbook repo for canonical parts-db data
- Assembles forge_database.json from handbook JSON files + local industry data
- Strips {% load static %} and {% static 'file' %} template tags
- Injects forge-static-adapter.js before any app scripts
- Copies all assets to a build/ directory ready for Cloudflare Pages
"""

import os
import re
import shutil
import json
import subprocess
import sys
import hashlib

SRC_DIR = 'forge-source'
BUILD_DIR = 'build'

# ── forge_database.json cache-buster ─────────────────────────────────────────
# `/static/*` is served `immutable, max-age=1yr` (see _headers) on the
# assumption that every asset URL carries a `?v=` buster. forge_database.json
# was fetched WITHOUT one, so refreshed parts/platform/category counts stayed
# pinned to a stale cached copy for up to a year — the page would flash the
# correct hardcoded numbers, then snap to the cached-stale data. We append a
# content-hash buster to every forge_database.json reference (HTML + JS) so a
# data refresh produces a new URL (cache miss → fresh fetch) while unchanged
# data keeps hitting cache. Computed lazily AFTER sync_handbook_data() has
# written the merged DB, so the hash reflects the actually-deployed bytes.
_DB_VERSION_CACHE = None
# Match `forge_database.json` not already followed by `?` (idempotent) and not
# part of a longer name (e.g. forge_database.schema.json is unaffected).
_DB_BUSTER_RE = re.compile(r'forge_database\.json(?!\?)')


def _db_version():
    """Short content hash of the deployed forge_database.json (cached)."""
    global _DB_VERSION_CACHE
    if _DB_VERSION_CACHE is None:
        try:
            with open(os.path.join(SRC_DIR, 'forge_database.json'), 'rb') as f:
                _DB_VERSION_CACHE = hashlib.sha1(f.read()).hexdigest()[:10]
        except Exception:
            _DB_VERSION_CACHE = '0'
    return _DB_VERSION_CACHE


def add_db_cache_buster(text):
    """Append `?v=<hash>` to bare forge_database.json references."""
    return _DB_BUSTER_RE.sub(lambda m: f'{m.group(0)}?v={_db_version()}', text)

# Pages to process  [rebuild 2026-04-10]
PAGES = {
    'index.html': 'builder/index.html',      # /builder/
    'mission-control.html': 'index.html',      # / (home — The Bench)
    'academy.html': 'academy/index.html',
    'support.html': 'support/index.html',
    'donate.html': 'donate/index.html',
    'audit.html': 'audit/index.html',
    'editor.html': 'library/index.html',
    'guide.html': 'guide/index.html',
    'template.html': 'template/index.html',
    'platforms.html': 'platforms/index.html',
    'browse.html': 'browse/index.html',
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
    'autonomy.html': 'autonomy/index.html',
    'fc-firmware-guide.html': 'fc-firmware-guide/index.html',
    'compliance.html': 'compliance/index.html',
    'spec-sheets.html': 'spec-sheets/index.html',
    'compliance-matrix.html': 'compliance-matrix/index.html',
    'dossier.html': 'dossier/index.html',
    'timeline.html': 'timeline/index.html',
    'compare.html': 'compare/index.html',
    'cost.html': 'cost/index.html',
    'intel-home.html': 'intel/index.html',
    'intel.html': 'intel/feed/index.html',
    # 'ddg.html': 'ddg/index.html',  # DDG (Defense Drone Gauntlet) temporarily disabled — re-enable by uncommenting
    'vault.html': 'vault/index.html',
    'troubleshoot.html': 'troubleshoot/index.html',  # Unlisted — no nav links
    'industry.html': 'industry/index.html',
    'intel-dfr.html': 'intel-dfr/index.html',
    'intel-commercial.html': 'intel-commercial/index.html',
    'payload-compare.html': 'payload-compare/index.html',
    'stack-builder.html': 'stack-builder/index.html',
    'circuit-forge.html': 'circuit-forge/index.html',
    'tools.html': 'tools/index.html',
    'wingman.html': 'wingman/index.html',
    'start.html': 'start/index.html',
    'forge-home.html': 'forge/index.html',
    'report.html': 'report/index.html',
    'waiver.html': 'waiver/index.html',
    'terms.html': 'terms/index.html',
    'privacy.html': 'privacy/index.html',
    'pid-tuning.html': 'pid-tuning/index.html',
    'patterns.html': 'patterns/index.html',
    'brief.html': 'brief/index.html',
    'patterns-home.html': 'patterns-home/index.html',
    'tools-home.html': 'tools-home/index.html',
    'software-library.html': 'software-library/index.html',
    'tracker.html': 'tracker/index.html',
    'grants.html': 'grants/index.html',
    'regs.html': 'regs/index.html',
    'verify.html': 'verify/index.html',
    'analytics.html': 'analytics/index.html',
    'clock.html': 'clock/index.html',
    'uas-hub.html': 'hub/index.html',       # /hub/ — UAS- landing page, all 5 domains
    'gallery.html': 'gallery/index.html',
    'entity-graph.html': 'entity-graph/index.html',
    # Patterns Hub lens pages — fed by data/*.json synced from Ai-Project pie-daily.yml
    'adversary-bom.html': 'adversary-bom/index.html',
    'mirroring.html': 'mirroring/index.html',
    'actors.html': 'actors/index.html',
    'ttps.html': 'ttps/index.html',
    'evasion.html': 'evasion/index.html',
    'market-lens.html': 'market-lens/index.html',
    'forecast-accountability.html': 'forecast-accountability/index.html',
    'pie-trends.html': 'pie-trends/index.html',
    'lexicon.html': 'lexicon/index.html',         # estimative-language reference
    'api-docs.html': 'api-docs/index.html',       # /api/data reference (NOT /api/* — that's worker-routed)
    # Doctrine submission + audit (Cloudflare/Netlify-Function backed)
    'contribute-doctrine.html': 'contribute-doctrine/index.html',
    'audit-doctrine.html': 'audit-doctrine/index.html',
    # ── PRIVATE gated area (Cloudflare Access on /private/*; see docs/PRIVATE_GATE.md) ──
    # DDG is served ONLY here (the public /ddg/ route above stays disabled).
    'private/index.html': 'private/index.html',
    'private/dossiers.html': 'private/dossiers/index.html',
    'private/supply-web.html': 'private/supply-web/index.html',
    'private/data.html': 'private/data/index.html',
    'private/components-bom.html': 'private/components-bom/index.html',
    'private/drone-config.html': 'private/drone-config/index.html',
    'ddg.html': 'private/ddg/index.html',
}

# Static assets to copy (JS, CSS, JSON, images)
STATIC_EXTENSIONS = {'.js', '.css', '.json', '.xml', '.png', '.jpg', '.svg', '.ico', '.gif', '.webp'}

# Files that must NOT appear in the public build/ static/ directory.
# These are served by forge-data.mjs with tier-based auth.
# forge_orqa_configs.json is NEVER served at any tier.
GATED_FROM_BUILD = {
    # commercial tier
    'intel_articles.json', 'intel_companies.json', 'intel_platforms.json', 'intel_programs.json',
    # pie_brief.json and pie_brief_history.json are in PUBLIC_SLICES in forge-data.mjs
    # and must be present at /static/ for the free-tier freeSummary path to work.
    'pie_trends.json', 'pie_weekly.json',
    'predictions_best.json', 'predictions_archive.json', 'llm_predictions.json',
    'gap_analysis_latest.json', 'entity_graph.json',
    'forge_intel.json', 'commercial_master.json',
    'solicitations.json',
    # dfr tier
    'dfr_master.json',
    # agency tier
    'defense_master.json',
    # NEVER served
    'forge_orqa_configs.json',
}


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


# Minified Forge analytics snippet — injected into every page at build time
# Tracks: page views, scroll depth, time on page, outbound clicks, tab switches,
#         component views, searches, filters, Wingman queries, PIE flag views,
#         intel article views. All anonymous, no cookies, no PII.
_ANALYTICS_SNIPPET = r"""(function(){var E=(location.hostname==='localhost'||location.hostname==='127.0.0.1'?'http://localhost:8788':'')+'/api/analytics/ingest',S='sess_'+crypto.randomUUID().replace(/-/g,'').slice(0,16),T=Date.now(),q=[],t=null,PG=typeof __FORGE_PAGE__!=='undefined'?__FORGE_PAGE__:'unknown';function reg(){try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(z.includes('America'))return'Americas';if(z.includes('Europe'))return'Europe';if(z.includes('Asia')||z.includes('Australia')||z.includes('Pacific'))return'Asia-Pacific';if(z.includes('Africa'))return'Africa';}catch(e){}return'Unknown';}function ev(tp,ac,p){q.push({event_id:crypto.randomUUID(),timestamp:new Date().toISOString(),surface:'forge',page:PG,event_type:tp,event_action:ac,context:{session_id:S,geo_region:reg(),platform:/Android|iPhone|iPad/i.test(navigator.userAgent)?'mobile':'web',viewport:innerWidth+'x'+innerHeight,path:location.pathname},payload:p,data_policy:{collection_tier:'anonymous',retention_days:90,anonymized:true}});if(q.length>=20)fl();else if(!t)t=setTimeout(fl,5e3);}function fl(){if(t){clearTimeout(t);t=null;}if(!q.length)return;var b=q.splice(0);fetch(E,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:b}),keepalive:true}).catch(function(){});}ev('page_view','view',{path:location.pathname,title:document.title,page:PG,referrer:document.referrer?new URL(document.referrer).hostname:'direct'});var ds=[25,50,75,100],ht=new Set;addEventListener('scroll',function(){var pct=Math.round(scrollY/(Math.max(document.body.scrollHeight-innerHeight,1))*100),el=(Date.now()-T)/1e3;ds.forEach(function(d){if(pct>=d&&!ht.has(d)){ht.add(d);ev('engagement','scroll_depth',{path:location.pathname,depth_pct:d,time_sec:Math.round(el)});}});},{passive:true});document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;try{var u=new URL(a.href);if(u.hostname!==location.hostname)ev('click','outbound_link',{from:location.pathname,to:u.hostname,text:a.textContent.trim().slice(0,80)});}catch(e){}});addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){ev('engagement','time_on_page',{path:location.pathname,duration_sec:Math.round((Date.now()-T)/1e3),deep_read:(Date.now()-T)>12e4});fl();}});addEventListener('pagehide',fl);window.__fa=window.__forgeAnalytics={search:function(q,cat,n){ev('search','component_search',{query:(q||'').slice(0,200),category:cat,result_count:n,had_results:n>0});if(!n)ev('search','no_results',{query:(q||'').slice(0,200),category:cat});},filter:function(cat,filters,n){ev('filter','apply_filter',{category:cat,filter_names:Object.keys(filters||{}),result_count:n,zero_results:!n});if(!n)ev('search','no_results',{query:'',category:cat,filters:filters});},view:function(pid,cat,mfr,country,ndaa){ev('page_view','component_detail',{pid:pid,category:cat,manufacturer:mfr,country:country,ndaa_compliant:ndaa});},compare:function(a,b,cat){ev('compare','side_by_side',{pid_a:a,pid_b:b,category:cat});},tab:function(name){ev('navigation','tab_switch',{tab:name,page:PG});},query:function(q,cat,img){ev('ai','wingman_query',{query:(q||'').slice(0,200),category:cat,has_image:!!img});},flag:function(id,sev,type){ev('intel','flag_view',{flag_id:id,severity:sev,flag_type:type});},intel:function(src,art){ev('intel','article_view',{source:src,article_id:art});},flush:fl};})();"""

# Page slug mapping — used to set __FORGE_PAGE__ per page
_PAGE_SLUGS = {
    'index.html': 'builder', 'mission-control.html': 'home',
    'patterns.html': 'patterns', 'patterns-home.html': 'patterns-home',
    'adversary-bom.html': 'adversary-bom', 'mirroring.html': 'mirroring',
    'actors.html': 'actors', 'ttps.html': 'ttps', 'evasion.html': 'evasion',
    'market-lens.html': 'market-lens',
    'forecast-accountability.html': 'forecast-accountability',
    'pie-trends.html': 'pie-trends',
    'lexicon.html': 'lexicon', 'api-docs.html': 'api-docs',
    'contribute-doctrine.html': 'contribute-doctrine', 'audit-doctrine.html': 'audit-doctrine',
    'intel.html': 'intel-feed', 'intel-home.html': 'intel-home', 'forge-home.html': 'forge',
    'intel-commercial.html': 'intel-commercial',
    'intel-dfr.html': 'intel-dfr',
    'wingman.html': 'wingman', 'browse.html': 'browse',
    'platforms.html': 'platforms', 'compare.html': 'compare',
    'cost.html': 'cost', 'payload-compare.html': 'payload-compare',
    'stack-builder.html': 'stack-builder', 'circuit-forge.html': 'circuit-forge', 'industry.html': 'industry',
    'tools.html': 'tools', 'tools-home.html': 'tools-home',
    'software-library.html': 'software-library',
    'brief.html': 'brief', 'report.html': 'report',
    'compliance.html': 'compliance', 'tracker.html': 'tracker',
    'spec-sheets.html': 'spec-sheets', 'compliance-matrix.html': 'compliance-matrix',
    'dossier.html': 'dossier',
    'timeline.html': 'timeline',
    'regs.html': 'regs', 'verify.html': 'verify', 'waiver.html': 'waiver',
    'grants.html': 'grants', 'audit.html': 'audit', 'guide.html': 'guide',
    'pid-tuning.html': 'pid-tuning', 'academy.html': 'academy',
    'support.html': 'support', 'gallery.html': 'gallery', 'entity-graph.html': 'entity-graph',
    'guides-hub.html': 'guides-hub', 'swarm-guide.html': 'swarm-guide',
    'swarm-selector.html': 'swarm', 'slam-guide.html': 'slam-guide',
    'slam-selector.html': 'slam', 'mesh-guide.html': 'mesh-guide',
    'tak-guide.html': 'tak-guide', 'openhd-guide.html': 'openhd-guide',
    'ai-guide.html': 'ai-guide', 'cuas-guide.html': 'cuas-guide',
    'fc-firmware-guide.html': 'fc-firmware-guide', 'vault.html': 'vault',
    'troubleshoot.html': 'troubleshoot', 'start.html': 'start',
    'contribute.html': 'contribute',
    'privacy.html': 'privacy', 'terms.html': 'terms',
}


_MOBILE_CSS = """<style>
@media(max-width:640px){
  /* Global card/grid overflow fix — prevents horizontal scroll on all pages */
  *{max-width:100%;box-sizing:border-box}
  img,video,iframe,table{max-width:100%!important}
  /* Force 2-col grids to single column on mobile */
  [style*="grid-template-columns:1fr 1fr"],[style*="grid-template-columns: 1fr 1fr"]{grid-template-columns:1fr!important}
  [style*="grid-template-columns:repeat(3"],[style*="grid-template-columns: repeat(3"]{grid-template-columns:1fr 1fr!important}
  [style*="grid-template-columns:repeat(4"],[style*="grid-template-columns: repeat(4"]{grid-template-columns:1fr 1fr!important}
  /* Stat tiles: 2-up on mobile */
  .an-stats,.stat-grid,.stats-grid{grid-template-columns:repeat(2,1fr)!important}
  /* Content padding tighten */
  .content{padding:12px 12px!important}
  /* Prevent wide modals/cards */
  .modal,.pred-modal,.flag-detail,[class*="-modal"]{width:calc(100vw - 24px)!important;max-width:calc(100vw - 24px)!important;left:12px!important;right:12px!important}
}
@media(max-width:400px){
  [style*="grid-template-columns:1fr 1fr"],[style*="grid-template-columns: 1fr 1fr"]{grid-template-columns:1fr!important}
  .an-stats,.stat-grid,.stats-grid{grid-template-columns:repeat(2,1fr)!important}
}
</style>"""



_UNIFIED_NAV = r"""<!-- ── Unified UAS- Nav (5-domain accordion drawer) ──────────────── -->
<style id="dc-unified-nav-styles">
#dc-nav{display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:44px;background:#0c0c0a;border-bottom:1px solid #1e1e18;position:sticky;top:0;z-index:500;font-family:'DM Sans',system-ui,sans-serif}
#dc-nav-left{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
#dc-nav-brand{font:700 13px 'JetBrains Mono',monospace;color:#f59e0b;text-decoration:none;letter-spacing:-.02em;flex-shrink:0}
#dc-nav-sep{color:#2e2e26;font-size:12px;flex-shrink:0}
#dc-nav-page{font:600 11px 'DM Sans',system-ui;color:#b8b0a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
#dc-nav-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
#dc-hamburger{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:6px;border:1px solid #2a2a22;background:none;color:#6b6358;cursor:pointer;transition:all .15s;flex-shrink:0}
#dc-hamburger:hover{border-color:#3e3e34;color:#b8b0a0}
#dc-hamburger.open{border-color:#dc2626;color:#dc2626;background:rgba(220,38,38,.08)}
.dc-nav-top-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:6px;border:1px solid #2a2a22;background:none;color:#b8b0a0;font:600 11px 'DM Sans',system-ui,sans-serif;text-decoration:none;cursor:pointer;transition:all .15s;flex-shrink:0}
.dc-nav-top-btn:hover{border-color:#f59e0b;color:#f59e0b;background:rgba(245,158,11,.06)}
.dc-nav-top-btn.dc-active{border-color:#22c55e;color:#22c55e;background:rgba(34,197,94,.06)}
.dc-nav-top-btn .dc-nav-top-ico{font-size:14px;line-height:1}
@media (max-width:520px){.dc-nav-top-btn span.dc-nav-top-label{display:none}}
#dc-overlay{position:fixed;inset:0;z-index:498;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .25s}
#dc-overlay.open{opacity:1;pointer-events:auto}
#dc-drawer{position:fixed;top:0;left:0;bottom:0;z-index:499;width:280px;max-width:85vw;background:#111110;border-right:1px solid #2a2a22;transform:translateX(-100%);transition:transform .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow-y:auto}
#dc-drawer.open{transform:translateX(0)}
#dc-drawer-head{padding:16px;border-bottom:1px solid #1e1e18;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
#dc-drawer-brand{font:700 14px 'JetBrains Mono',monospace;color:#f59e0b;letter-spacing:-.02em}
#dc-drawer-close{width:28px;height:28px;border-radius:6px;border:1px solid #2a2a22;background:none;color:#6b6358;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s}
#dc-drawer-close:hover{color:#dc2626;border-color:rgba(220,38,38,.3)}
.dc-dom-group{border-bottom:1px solid #1a1a14}
.dc-dom-group > summary{padding:14px 16px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:12px;transition:all .15s;user-select:none}
.dc-dom-group > summary::-webkit-details-marker{display:none}
.dc-dom-group > summary::marker{content:''}
.dc-dom-group > summary:hover{background:rgba(255,255,255,.02)}
.dc-dom-ico{font-size:18px;flex-shrink:0;filter:grayscale(.3)}
.dc-dom-info{flex:1;min-width:0}
.dc-dom-name{font:700 12px 'DM Sans',system-ui;color:#b8b0a0;letter-spacing:-.01em;transition:color .15s}
.dc-dom-url{font:400 9px 'JetBrains Mono',monospace;color:#6b6358;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-dom-chev{color:#3e3e34;font-size:9px;transition:transform .2s;flex-shrink:0}
.dc-dom-group[open] > summary .dc-dom-chev{transform:rotate(90deg);color:#dc2626}
.dc-dom-group[open] > summary .dc-dom-name{color:#dc2626}
.dc-dom-group[open] > summary .dc-dom-ico{filter:grayscale(0)}
.dc-dom-sublinks{padding:0 0 10px 0;display:flex;flex-direction:column;gap:0;background:rgba(0,0,0,.15)}
.dc-dom-sublink{display:block;padding:8px 16px 8px 46px;font:400 11px 'DM Sans',system-ui;color:#6b6358;text-decoration:none;border-left:2px solid transparent;transition:all .1s}
.dc-dom-sublink:hover{color:#b8b0a0;background:rgba(255,255,255,.02);border-left-color:#2e2e26}
.dc-dom-sublink.dc-active{color:#22c55e;border-left-color:#22c55e;background:rgba(34,197,94,.04)}
.dc-dom-standalone{padding:14px 16px;display:flex;align-items:center;gap:12px;text-decoration:none;border-bottom:1px solid #1a1a14;transition:all .15s}
.dc-dom-standalone:hover{background:rgba(255,255,255,.02)}
.dc-dom-standalone:hover .dc-dom-name{color:#dc2626}
.dc-dom-standalone:hover .dc-dom-ico{filter:grayscale(0)}
.dc-dom-standalone.dc-active .dc-dom-name{color:#22c55e}
.dc-dom-standalone.dc-active{background:rgba(34,197,94,.04);border-left:2px solid #22c55e}
#dc-drawer-foot{margin-top:auto;padding:16px;border-top:1px solid #1e1e18;font:400 10px 'JetBrains Mono',monospace;color:#2e2e26;display:flex;flex-direction:column;gap:6px}
#dc-drawer-foot a{color:#f59e0b;text-decoration:none}
#dc-drawer-foot a:hover{color:#dc2626}
</style>

<nav id="dc-nav">
  <div id="dc-nav-left">
    <button id="dc-hamburger" onclick="dcNavToggle()" aria-label="Menu">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <line x1="1" y1="3" x2="13" y2="3"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="11" x2="13" y2="11"/>
      </svg>
    </button>
    <a id="dc-nav-brand" href="/" onclick="return dcNavBrandClick(event)">—</a>
    <span id="dc-nav-sep">/</span>
    <span id="dc-nav-page">—</span>
  </div>
  <div id="dc-nav-right">
    <a class="dc-nav-top-btn" href="https://uas-forge.com/donate/" data-page="donate" title="Support the project">
      <span class="dc-nav-top-ico">❤️</span>
      <span class="dc-nav-top-label">Donate</span>
    </a>
    <a class="dc-nav-top-btn" href="https://uas-forge.com/wingman/" data-page="wingman" title="Wingman AI">
      <span class="dc-nav-top-ico">🤖</span>
      <span class="dc-nav-top-label">Wingman</span>
    </a>
  </div>
</nav>

<div id="dc-overlay" onclick="dcNavClose()"></div>
<div id="dc-drawer">
  <div id="dc-drawer-head">
    <span id="dc-drawer-brand">UAS-</span>
    <button id="dc-drawer-close" onclick="dcNavClose()">✕</button>
  </div>

  <details class="dc-dom-group" data-host="uas-forge.com" data-hub-href="https://uas-forge.com/forge/">
    <summary>
      <span class="dc-dom-ico">🔨</span>
      <div class="dc-dom-info">
        <div class="dc-dom-name">Forge</div>
        <div class="dc-dom-url">uas-forge.com</div>
      </div>
      <span class="dc-dom-chev">▶</span>
    </summary>
    <div class="dc-dom-sublinks">
      <a class="dc-dom-sublink" href="https://uas-forge.com/forge/" data-page="forge">Forge Hub</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/browse/" data-page="browse">Parts Database</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/builder/" data-page="builder">Model Builder</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/platforms/" data-page="platforms">Platforms</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/compare/" data-page="compare">Compare</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/compliance/" data-page="compliance">Compliance Dashboard</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/stack-builder/" data-page="stack-builder">Stack Builder</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/circuit-forge/" data-page="circuit-forge">Circuit Forge (AI)</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/cost/" data-page="cost">Cost Estimator</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/waiver/" data-page="waiver">Document Builder</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/wingman/" data-page="wingman">Wingman AI</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/gallery/" data-page="gallery">Featured Builds</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/entity-graph/" data-page="entity-graph">Entity Graph</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/tools-home/" data-page="tools-home">All Tools</a>
    </div>
  </details>

  <details class="dc-dom-group" data-host="uas-forge.com" data-hub-href="https://uas-forge.com/guides/">
    <summary>
      <span class="dc-dom-ico">📐</span>
      <div class="dc-dom-info">
        <div class="dc-dom-name">Guides</div>
        <div class="dc-dom-url">uas-forge.com</div>
      </div>
      <span class="dc-dom-chev">▶</span>
    </summary>
    <div class="dc-dom-sublinks">
      <a class="dc-dom-sublink" href="https://uas-forge.com/guides/" data-page="guides-hub">All Guides</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/fc-firmware-guide/" data-page="fc-firmware-guide">FC Firmware</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/mesh-guide/" data-page="mesh-guide">Mesh Radio</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/tak-guide/" data-page="tak-guide">TAK / CoT</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/slam-guide/" data-page="slam-guide">SLAM / VIO</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/openhd-guide/" data-page="openhd-guide">OpenHD / FPV</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/swarm-guide/" data-page="swarm-guide">Swarm</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/cuas-guide/" data-page="cuas-guide">Counter-UAS</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/ai-guide/" data-page="ai-guide">AI / Autonomy</a>
    </div>
  </details>

  <details class="dc-dom-group" data-host="uas-patterns.com" data-hub-href="https://uas-patterns.com/patterns-home/">
    <summary>
      <span class="dc-dom-ico">📊</span>
      <div class="dc-dom-info">
        <div class="dc-dom-name">Patterns</div>
        <div class="dc-dom-url">uas-patterns.com</div>
      </div>
      <span class="dc-dom-chev">▶</span>
    </summary>
    <div class="dc-dom-sublinks">
      <a class="dc-dom-sublink" href="https://uas-patterns.com/patterns-home/" data-page="patterns-home">P.I.E Hub</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/brief/" data-page="brief">Daily Brief</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/patterns/" data-page="patterns">Flags Dashboard</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/adversary-bom/" data-page="adversary-bom">Adversary BOM</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/mirroring/" data-page="mirroring">Component Mirroring</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/actors/" data-page="actors">Threat Actors</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/ttps/" data-page="ttps">TTP Defense Gap</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/evasion/" data-page="evasion">Sanctions-Evasion</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/market-lens/" data-page="market-lens">Market Lens</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/forecast-accountability/" data-page="forecast-accountability">Forecast Accountability</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/pie-trends/" data-page="pie-trends">PIE Trends</a>
    </div>
  </details>

  <details class="dc-dom-group" data-host="uas-patterns.com" data-hub-href="https://uas-patterns.com/intel/">
    <summary>
      <span class="dc-dom-ico">📡</span>
      <div class="dc-dom-info">
        <div class="dc-dom-name">Intel</div>
        <div class="dc-dom-url">uas-patterns.com</div>
      </div>
      <span class="dc-dom-chev">▶</span>
    </summary>
    <div class="dc-dom-sublinks">
      <a class="dc-dom-sublink" href="https://uas-patterns.com/intel/feed/" data-page="intel-feed">Intel Feed</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/intel-commercial/" data-page="intel-commercial">Commercial Desk</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/intel-dfr/" data-page="intel-dfr">DFR Desk</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/industry/" data-page="industry">Industry Tracker</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/tracker/" data-page="tracker">Contract Tracker</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/grants/" data-page="grants">Grants</a>
      <a class="dc-dom-sublink" href="https://uas-patterns.com/timeline/" data-page="timeline">Regulatory Timeline</a>
    </div>
  </details>

  <details class="dc-dom-group" data-host="uas-handbook.com">
    <summary>
      <span class="dc-dom-ico">📘</span>
      <div class="dc-dom-info">
        <div class="dc-dom-name">Handbook</div>
        <div class="dc-dom-url">uas-handbook.com</div>
      </div>
      <span class="dc-dom-chev">▶</span>
    </summary>
    <div class="dc-dom-sublinks">
      <a class="dc-dom-sublink" href="https://uas-handbook.com/" data-page="handbook">Read the handbook</a>
      <a class="dc-dom-sublink" href="https://uas-handbook.com/#c13" data-page="ch13">Chapter 13 — Parts</a>
      <a class="dc-dom-sublink" href="https://uas-handbook.com/#c05" data-page="ch05">Chapter 5 — Mesh</a>
      <a class="dc-dom-sublink" href="https://uas-handbook.com/#c08" data-page="ch08">Chapter 8 — NDAA</a>
    </div>
  </details>

  <!-- Intel (gated) — links live in the public menu but require Cloudflare Access -->
  <details class="dc-dom-group" data-host="uas-forge.com" data-hub-href="https://uas-forge.com/private/">
    <summary>
      <span class="dc-dom-ico">🔒</span>
      <div class="dc-dom-info">
        <div class="dc-dom-name">Intel (Private)</div>
        <div class="dc-dom-url">uas-forge.com/private · gated</div>
      </div>
      <span class="dc-dom-chev">▶</span>
    </summary>
    <div class="dc-dom-sublinks">
      <a class="dc-dom-sublink" href="https://uas-forge.com/private/ddg/" data-page="ddg">DDG Tracker</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/private/dossiers/" data-page="dossiers">Intel Dossiers</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/private/supply-web/" data-page="supply-web">Supply Web</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/private/components-bom/" data-page="components-bom">Component BOMs</a>
      <a class="dc-dom-sublink" href="https://uas-forge.com/private/drone-config/" data-page="drone-config">Build Configurator</a>
    </div>
  </details>

  <!-- Standalone quick links — not grouped under any domain -->
  <a class="dc-dom-standalone" href="https://uas-forge.com/wingman/" data-page="wingman">
    <span class="dc-dom-ico">🤖</span>
    <div class="dc-dom-info">
      <div class="dc-dom-name">Wingman AI</div>
      <div class="dc-dom-url">uas-forge.com/wingman/</div>
    </div>
  </a>
  <a class="dc-dom-standalone" href="https://uas-patterns.com/clock/" data-page="clock">
    <span class="dc-dom-ico">⏰</span>
    <div class="dc-dom-info">
      <div class="dc-dom-name">UAS Clock</div>
      <div class="dc-dom-url">uas-patterns.com/clock/</div>
    </div>
  </a>
  <a class="dc-dom-standalone" aria-disabled="true" data-page="ddg">
    <span class="dc-dom-ico">🎯</span>
    <div class="dc-dom-info">
      <div class="dc-dom-name">DDG Tracker</div>
      <div class="dc-dom-url">uas-patterns.com/ddg/</div>
    </div>
  </a>
  <a class="dc-dom-standalone" href="https://uas-forge.com/hub/" data-page="hub">
    <span class="dc-dom-ico">⊞</span>
    <div class="dc-dom-info">
      <div class="dc-dom-name">UAS- Hub</div>
      <div class="dc-dom-url">all 5 domains</div>
    </div>
  </a>
  <a class="dc-dom-standalone" href="https://uas-forge.com/donate/" data-page="donate">
    <span class="dc-dom-ico">❤️</span>
    <div class="dc-dom-info">
      <div class="dc-dom-name">Support / Donate</div>
      <div class="dc-dom-url">keep the tools free</div>
    </div>
  </a>

  <div id="dc-drawer-foot">
    <span>Midwest Nice Advisory LLC</span>
    <span style="color:#3e3e34">uasdash.com</span>
  </div>
</div>

<script>
(function(){
  var path = location.pathname.replace(/\/$/, '').split('/').pop() || 'home';
  var isPro = (function(){
    try {
      var tok = localStorage.getItem('forge_token') || localStorage.getItem('wingman_sub_token') || '';
      if(!tok || tok.length < 20) return false;
      var p = JSON.parse(atob(tok.split('.')[1] || tok));
      var payload = p.payload || p;
      return !!(payload.tier && payload.tier !== 'free' && (!payload.exp || payload.exp > Date.now()));
    } catch(e){ return false; }
  })();
  var host = location.hostname;
  // Domain detection — matches new uas-* AND legacy nvmill*/illdoitmyself during transition
  var isForge    = host.indexOf('uas-forge') >= 0 || host.indexOf('builditmyself') >= 0 || host === 'localhost' || host.indexOf('forgeprole') >= 0;
  var isPatCom   = host.indexOf('uas-patterns') >= 0 || host.indexOf('findoutmyself') >= 0;
  var isIntel    = host.indexOf('uas-intel') >= 0;
  var isHandbook = host.indexOf('uas-handbook') >= 0 || host.indexOf('doitmyself') >= 0 || host.indexOf('illdoitmyself') >= 0;

  // Page labels for the top bar
  var labels = {
    'browse':'Browse','wingman':'Wingman','intel':'Intel Hub','compare':'Compare',
    'compliance':'Compliance','dossier':'Dossier','platforms':'Platforms','regs':'Regs',
    'stack-builder':'Stack Builder','circuit-forge':'Circuit Forge','report':'Compliance Report','tools-home':'Tools',
    'software-library':'Software Library','industry':'Industry','tracker':'Contract Tracker',
    'patterns-home':'P.I.E Hub','brief':'Brief','patterns':'Flags','clock':'UAS Clock','ddg':'DDG Tracker',
    'adversary-bom':'Adversary BOM','mirroring':'Component Mirroring','actors':'Threat Actors',
    'ttps':'TTP Defense Gap','evasion':'Sanctions-Evasion','market-lens':'Market Lens',
    'forecast-accountability':'Forecast Accountability','pie-trends':'PIE Trends',
    'contribute-doctrine':'Contribute Doctrine','audit-doctrine':'Doctrine Audit',
    'start':'Getting Started','grants':'Grants','waiver':'Doc Builder','forge':'Forge Hub',
    'verify':'Verify','vault':'Vault','troubleshoot':'Troubleshoot','support':'Support','donate':'Support','hub':'Hub','gallery':'Featured Builds','entity-graph':'Entity Graph',
    'builder':'Builder','cost':'Cost','analytics':'Analytics'
  };
  var pageEl = document.getElementById('dc-nav-page');
  if(pageEl) pageEl.textContent = labels[path] || document.title.split('—')[0].trim().split('·')[0].trim() || path;

  // Brand label — per domain
  var brandName = isForge    ? 'Forge'
                : isPatCom   ? 'Patterns'
                : isIntel    ? 'Intel'
                : isHandbook ? 'Handbook'
                : 'UAS-';
  var brandEl = document.getElementById('dc-nav-brand');
  var drawerBrandEl = document.getElementById('dc-drawer-brand');
  if(brandEl) brandEl.textContent = brandName;
  if(drawerBrandEl) drawerBrandEl.textContent = brandName;

  // Brand-click home target per domain
  window.dcNavBrandClick = function(e){
    e.preventDefault();
    if(isForge)         location.href = 'https://uas-forge.com/forge/';
    else if(isPatCom)   location.href = 'https://uas-patterns.com/patterns-home/';
    else if(isIntel)    location.href = 'https://uas-patterns.com/';
    else if(isHandbook) location.href = 'https://uas-handbook.com/';
    else                location.href = 'https://uas-forge.com/hub/';
  };

  // Auto-expand the drawer group matching current host
  var currentHost = isForge    ? 'uas-forge.com'
                  : isPatCom   ? 'uas-patterns.com'
                  : isIntel    ? 'uas-patterns.com'
                  : isHandbook ? 'uas-handbook.com'
                  : 'uas-forge.com';
  document.querySelectorAll('.dc-dom-group').forEach(function(g){
    if(g.dataset.host === currentHost) g.open = true;
  });

  // Mark active sublink AND standalone AND top-bar buttons (match data-page)
  document.querySelectorAll('.dc-dom-sublink, .dc-dom-standalone, .dc-nav-top-btn').forEach(function(a){
    if(a.dataset.page === path) a.classList.add('dc-active');
  });

  // Domain groups with data-hub-href: clicking the name/icon navigates to the
  // hub URL; clicking the chev still toggles the dropdown.
  document.querySelectorAll('.dc-dom-group[data-hub-href] > summary').forEach(function(s){
    s.addEventListener('click', function(e){
      if(e.target.closest('.dc-dom-chev')) return; // chev: default toggle
      e.preventDefault();
      location.href = s.parentElement.dataset.hubHref;
    });
  });

  // Hamburger toggle
  window.dcNavToggle = function(){
    var open = document.getElementById('dc-drawer').classList.toggle('open');
    document.getElementById('dc-overlay').classList.toggle('open', open);
    document.getElementById('dc-hamburger').classList.toggle('open', open);
  };
  window.dcNavClose = function(){
    document.getElementById('dc-drawer').classList.remove('open');
    document.getElementById('dc-overlay').classList.remove('open');
    document.getElementById('dc-hamburger').classList.remove('open');
  };
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') dcNavClose(); });
})();
</script>
<!-- ── /Unified UAS- Nav ─────────────────────────────────────────── -->"""


# ── Global "point of reliance" disclaimer ────────────────────────────────
# Forge/Patterns/Clock carry compliance labels, risk scores, threat/sanctions
# signals and procurement intel that are AI-assisted, public-source analysis —
# NOT legal/compliance findings or accusations. The protective language used to
# live only in internal notes (compliance/README, research/*.md) and a couple of
# page-specific caveats (market-lens, forecast-accountability). This injects a
# visible, non-dismissible banner at the bottom of the content on every
# risk-bearing surface so a reasonable reader sees the framing without the
# big red box crowding out the actual data above the fold. Styles are
# self-contained (no dependence on per-page CSS vars) so the banner renders
# identically regardless of which template it lands in.
_DISCLAIMER_CSS = """<style id="forge-disclaimer-styles">
.forge-disclaimer{max-width:1100px;margin:14px auto 18px;padding:13px 16px;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.28);border-left:3px solid #ef4444;border-radius:6px;font-family:'DM Sans',system-ui,-apple-system,sans-serif;color:#b8b0a0;line-height:1.6;box-sizing:border-box}
@media(max-width:1140px){.forge-disclaimer{margin-left:16px;margin-right:16px}}
.forge-disclaimer__tag{display:block;font:700 10px 'JetBrains Mono',ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#f87171;margin-bottom:6px}
.forge-disclaimer p{margin:0 0 6px;font-size:12px}
.forge-disclaimer p:last-child{margin-bottom:0}
.forge-disclaimer strong{color:#e8e2d6}
.forge-disclaimer a{color:#f59e0b;text-decoration:underline;text-decoration-color:rgba(245,158,11,.4)}
</style>"""

# The general line — used on every risk-bearing surface.
_DISCLAIMER_GENERAL = (
    "<strong>AI-assisted public-source analysis.</strong> Not legal, procurement, "
    "export-control, airworthiness, or operational advice. Compliance labels and "
    "risk scores are informational and may be incomplete or stale. Verify against "
    "official sources, vendor attestations, and qualified counsel before relying "
    "on them."
)

# The Patterns/threat line — adds the "signals, not allegations" framing on
# pages that score, flag, or rank companies / platforms / actors.
_DISCLAIMER_SIGNALS = (
    "<strong>Risk labels are analytic signals, not allegations of unlawful "
    "conduct.</strong> They reflect public-source indicators, confidence levels, "
    "and available data at the time generated."
)

_DISCLAIMER_TAGS = {
    "compliance": "Informational — Not Legal or Compliance Advice",
    "patterns": "Analytic Signal — Not an Allegation",
}

# Map source page → disclaimer variant.
#   "compliance" → general line only (legal / procurement / export / airworthiness)
#   "patterns"   → general line + "signals, not allegations" (scoring / threat / intel)
# Pages that already carry a prominent above-the-fold `.caveat-strong` of their
# own (market-lens, forecast-accountability) are intentionally omitted so we
# don't stack two red banners.
_DISCLAIMER_PAGES = {
    # Compliance / procurement / regulatory
    "compliance.html": "compliance",
    "compliance-matrix.html": "compliance",
    "audit.html": "compliance",
    "audit-doctrine.html": "compliance",
    "regs.html": "compliance",
    "waiver.html": "compliance",
    "grants.html": "compliance",
    "verify.html": "compliance",
    "spec-sheets.html": "compliance",
    # Patterns / PIE / threat / sanctions / gray-zone / intel + the Clock
    "patterns.html": "patterns",
    "patterns-home.html": "patterns",
    "pie-trends.html": "patterns",
    "brief.html": "patterns",
    "ttps.html": "patterns",
    "evasion.html": "patterns",
    "actors.html": "patterns",
    "adversary-bom.html": "patterns",
    "mirroring.html": "patterns",
    "entity-graph.html": "patterns",
    "tracker.html": "patterns",
    "dossier.html": "patterns",
    "intel.html": "patterns",
    "intel-home.html": "patterns",
    "intel-dfr.html": "patterns",
    "intel-commercial.html": "patterns",
    "clock.html": "patterns",
}


def _disclaimer_block(variant):
    """Build the self-contained <style> + <aside> banner for a variant."""
    tag = _DISCLAIMER_TAGS["patterns" if variant == "patterns" else "compliance"]
    paras = "<p>" + _DISCLAIMER_GENERAL + "</p>"
    if variant == "patterns":
        paras += "\n  <p>" + _DISCLAIMER_SIGNALS + "</p>"
    aside = (
        '<aside class="forge-disclaimer" role="note" '
        'data-test-id="forge-global-disclaimer">\n'
        f'  <span class="forge-disclaimer__tag">{tag}</span>\n'
        f'  {paras}\n'
        '</aside>'
    )
    return _DISCLAIMER_CSS + "\n" + aside


def inject_disclaimer(html, src_name):
    """Inject the visible point-of-reliance disclaimer at the bottom of content.

    Inserted just before </body> so the framing sits at the foot of the page
    instead of pushing the actual data below a big red box above the fold.
    Idempotent and a no-op for pages not in _DISCLAIMER_PAGES.
    """
    variant = _DISCLAIMER_PAGES.get(src_name)
    if not variant:
        return html
    if 'data-test-id="forge-global-disclaimer"' in html:
        return html

    block = "\n" + _disclaimer_block(variant) + "\n"

    # Prefer immediately before the closing </body> tag.
    if '</body>' in html:
        return html.replace('</body>', block + '</body>', 1)

    # Fallback: append at the very end of the document.
    return html + block


def inject_nav(html, src_name):
    """Inject unified nav after <body> on every page except analytics and clock.

    Strips any pre-existing `<!-- ── Unified ... Nav ── -->` block from the
    source HTML first — the source files historically embedded a stale copy
    of the nav, and without stripping it first the old "DroneClear / Forge
    pills / PIE pills" nav would win. Strip-then-inject is idempotent.
    """
    skip = {"analytics.html", "clock.html"}
    if src_name in skip:
        return html

    # Strip any existing nav block (old OR new — matches any brand name
    # between "Unified" and "Nav", handles DroneClear / UAS- / future renames)
    html = re.sub(
        r'<!-- ── Unified[^\n]*?Nav[^\n]*?-->.*?<!-- ── /Unified[^\n]*?-->',
        '',
        html,
        count=1,
        flags=re.DOTALL,
    )

    # Inject the fresh nav after <body>
    nav_block = "\n" + _UNIFIED_NAV + "\n"
    if "<body>" in html:
        return html.replace("<body>", "<body>" + nav_block, 1)
    return html


def strip_baked_analytics(html):
    """Remove old baked-in analytics snippets (thebluefairy/netlify) from source HTML.
    The build pipeline injects a canonical snippet via inject_analytics(), so any
    pre-existing snippet in the source file is a duplicate that must be removed.
    """
    # Match <script>...</script> blocks containing the old analytics endpoint
    pattern = re.compile(
        r"<script>[^<]*thebluefairy\.netlify\.app[^<]*</script>",
        re.DOTALL
    )
    return pattern.sub('', html)

def inject_analytics(html, src_name):
    """Inject Forge analytics snippet and global mobile CSS before </body> on every page."""
    slug = _PAGE_SLUGS.get(src_name, src_name.replace('.html', ''))
    tag = (
        f'\n<script>var __FORGE_PAGE__="{slug}";</script>\n'
        f'<script>{_ANALYTICS_SNIPPET}</script>\n'
        f'{_MOBILE_CSS}\n'
    )
    html = inject_nav(html, src_name)
    if '</body>' in html:
        return html.replace('</body>', tag + '</body>', 1)
    return html + tag


def fix_paths(html, depth=0):
    """Fix static asset paths for the nested directory structure."""
    prefix = '../' * depth if depth > 0 else ''
    
    if depth > 0:
        # Fix CSS/JS/JSON references: static/file.ext Ã¢ÂÂ ../static/file.ext
        html = re.sub(r'(href|src)="static/', rf'\1="{prefix}static/', html)
        html = re.sub(r"(href|src)='static/", rf"\1='{prefix}static/", html)
        # Fix fetch calls to static JSON
        html = html.replace("fetch('forge_database.json')", f"fetch('{prefix}static/forge_database.json')")
        html = html.replace("fetch('forge_intel.json')", "fetch('/forge_intel.json')")
        html = html.replace("fetch('forge_troubleshooting.json')", f"fetch('{prefix}static/forge_troubleshooting.json')")
        html = html.replace("fetch('intel_articles.json')", "fetch('/api/data?type=intel_articles&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
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
        html = html.replace("fetch('pie_flags.json')", "fetch('/api/data?type=pie_flags&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
        html = html.replace("fetch('solicitations.json')", "fetch('/api/data?type=solicitations&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
        html = html.replace("fetch('miner_registry.json')", f"fetch('{prefix}static/miner_registry.json')")
        html = html.replace('fetch("../static/miner_health.json")', f"fetch('{prefix}static/miner_health.json')")
        html = html.replace("fetch('miner_health.json')", f"fetch('{prefix}static/miner_health.json')")
        html = html.replace("fetch('/static/gap_analysis_latest.json')", f"fetch('{prefix}static/gap_analysis_latest.json')")
        html = html.replace("fetch('pie_predictions.json')", "fetch('/api/data?type=pie_predictions&token='+encodeURIComponent(localStorage.getItem('forge_token')||localStorage.getItem('wingman_sub_token')||''))")
        html = html.replace("fetch('pie_brief.json')", "fetch('/api/data?type=pie_brief&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
        html = html.replace("fetch('pie_weekly.json')", "fetch('/api/data?type=pie_weekly&token='+encodeURIComponent(localStorage.getItem('forge_token')||localStorage.getItem('wingman_sub_token')||''))")
        html = html.replace("fetch('forge_firmware_configs.json')", f"fetch('{prefix}static/forge_firmware_configs.json')")
        html = html.replace("fetch('forge_firmware_versions.json')", f"fetch('{prefix}static/forge_firmware_versions.json')")
        html = html.replace("fetch('forge_incompatibilities.json')", f"fetch('{prefix}static/forge_incompatibilities.json')")
        # Dossier / compliance data files
        html = html.replace("fetch('forge_manufacturer_status.json')", f"fetch('{prefix}static/forge_manufacturer_status.json')")
        html = html.replace("fetch('forge_alternatives.json')", f"fetch('{prefix}static/forge_alternatives.json')")
        html = html.replace("fetch('forge_848_spec_sheets.json')", f"fetch('{prefix}static/forge_848_spec_sheets.json')")
        html = html.replace("fetch('forge_compliance_events.json')", f"fetch('{prefix}static/forge_compliance_events.json')")
        # forge_orqa_configs.json — NEVER served, rewrite to no-op
        html = html.replace("fetch('forge_orqa_configs.json')", "fetch('/dev/null')")
    
    # Fix nav links to use clean URLs
    html = html.replace('href="/"', 'href="/"')

    # Cache-bust forge_database.json (immutable /static/* otherwise pins stale
    # parts/platform counts). Runs for ALL depths, after the relative-fetch
    # rewrites above, so it also catches the absolute `/static/forge_database.json`
    # literals used by forge-home.html, index.html, mission-control.html, etc.
    html = add_db_cache_buster(html)

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
        "href=\"/support/\"": f'href="{prefix}support/"',
        "window.location.href = '/'": f"window.location.href = '{prefix or '/'}'",
    }

    for old, new in replacements.items():
        html = html.replace(old, new)

    return html


def rewrite_legacy_domains(html):
    """Rewrite all occurrences of legacy nvmill*/illdoitmyself domains
    to their new uas-* equivalents. Runs at build time so the source HTML
    files can be left unchanged — a pragmatic mass-replace that catches
    hardcoded URLs embedded in any of the ~20 page templates.

    All Forge paths route to uas-forge.com.
    All Patterns paths (including former Pro) route to uas-patterns.com.
    Handbook references route to uas-handbook.com.

    Also catches dangling `/pro/` and `/admin/` links from the retired
    Patterns Pro tier — rewrites them to `/` so pages that still have
    "Subscribe" / "Upgrade" CTAs don't 404. The surrounding copy is stale
    but harmless; a follow-up pass can clean up the gating language.
    """
    # Bare-domain replacements (catch-all for everything else)
    bare = [
        ('https://thebluefairy.netlify.app/.netlify/functions/', '/api/'),
        ('/.netlify/functions/', '/api/'),
        ('https://www.uas-forge.com', 'https://uas-forge.com'),
        ('https://uas-forge.com',     'https://uas-forge.com'),
        ('https://www.uas-intel.com', 'https://uas-patterns.com'),
        ('https://uas-intel.com',     'https://uas-patterns.com'),
        ('https://www.uas-handbook.com',    'https://uas-handbook.com'),
        ('https://uas-handbook.com',        'https://uas-handbook.com'),
        ('https://www.illdoitmyself.com',       'https://uas-handbook.com'),
        ('https://illdoitmyself.com',           'https://uas-handbook.com'),
        # Retired uas-patterns.pro → .com
        ('https://www.uas-patterns.pro',        'https://uas-patterns.com'),
        ('https://uas-patterns.pro',            'https://uas-patterns.com'),
    ]
    for old, new in bare:
        html = html.replace(old, new)

    # Retired /pro/ and /admin/ pages → homepage. Only touch href attributes
    # so raw text mentions of "/pro/" (e.g., in code blocks or docs copy)
    # are left alone.
    html = re.sub(r'''href=(["'])/pro/\1''', r'href=\1/\1', html)
    html = re.sub(r'''href=(["'])/admin/\1''', r'href=\1/\1', html)

    return html


# Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ
# SEO — Meta tags, Open Graph, Twitter Cards, Sitemap, robots.txt
# Ã¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂÃ¢ÂÂ

SITE_URL = 'https://uas-forge.com'
SITE_NAME = 'Forge — Drone Integration Handbook'

# Part count for SEO copy. Computed once from forge_database.json on first
# read, then cached. Falls back to 3500 if the file is unavailable so the
# build doesn't break — same number the strings used to hardcode.
_PART_COUNT_CACHE = None
_PART_COUNT_PLACEHOLDER = '__PART_COUNT__'

def _get_part_count():
    global _PART_COUNT_CACHE
    if _PART_COUNT_CACHE is not None:
        return _PART_COUNT_CACHE
    try:
        with open(os.path.join(SRC_DIR, 'forge_database.json'), 'r', encoding='utf-8') as f:
            db = json.load(f)
        comps = db.get('components', {})
        _PART_COUNT_CACHE = sum(len(v) for v in comps.values() if isinstance(v, list))
    except Exception:
        _PART_COUNT_CACHE = 3500
    return _PART_COUNT_CACHE

# SEO metadata per page: (title, description, keywords)
# Use __PART_COUNT__ as a placeholder; inject_seo() substitutes the real
# count at use time so the meta description always matches the live DB.
# Round down to the nearest 100 + "+" so the public number doesn't churn
# on every commit.
SEO_META = {
    'mission-control.html': (
        'Forge — Drone Build Planner & Intelligence Platform',
        'Browse __PART_COUNT__+ vetted drone parts, validate build compatibility, assemble step-by-step guides, and access defense intelligence. The interactive companion to the Drone Integration Handbook.',
        'drone build planner, FPV parts database, drone compatibility, NDAA compliant drones, Blue UAS, drone components',
    ),
    'index.html': (
        'Model Builder — Forge Drone Build Planner',
        'Assemble drone builds from __PART_COUNT__+ vetted parts with real-time 12-check compatibility validation. Flight controllers, ESCs, motors, frames, and more.',
        'drone model builder, FPV build tool, drone parts compatibility, flight controller selector',
    ),
    'wingman.html': (
        'Wingman AI — Drone Troubleshooter & Wiring Analyzer',
        'AI-powered FPV drone troubleshooter. Upload photos for wiring analysis, get PID tuning help, firmware guidance, and real-time web search. Powered by Gemini.',
        'drone troubleshooter AI, FPV wiring analyzer, Betaflight help, drone repair assistant, PID tuning AI',
    ),
    'circuit-forge.html': (
        'Circuit Forge — AI Hardware Design & Wiring Diagram Generator',
        'Describe a hardware project in plain English and get a wired schematic, bill of materials, Arduino firmware, and an automated electrical-rule check. Grounded with canonical Arduino/ESP32/sensor pinouts.',
        'AI circuit designer, wiring diagram generator, Arduino schematic AI, ESP32 wiring, bill of materials generator, electrical rule check',
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
        'Check NDAA 848 (FY2020), ASDA / FAR 52.240-1 (FY2024), Blue UAS certification, ITAR, FCC Covered List, and country-of-origin status for 219 drone platforms. Traffic-light compliance tiers.',
        'NDAA 848 drone compliance, ASDA drone, FAR 52.240-1, Blue UAS cleared drones, FCC covered list UAS, drone procurement compliance',
    ),
    'spec-sheets.html': (
        'NDAA 848 Spec Sheet Viewer - Drone Component Compliance PDFs',
        'Searchable cross-vendor index of NDAA 848 compliance spec sheets and component-origin declarations from UAS manufacturers. Freefly, Inspired Flight, Hylio, ORQA, Skydio and more. The first free aggregator - no such database exists at DoD, DIU, or SAM.gov.',
        'NDAA 848 spec sheet, drone compliance PDF, component origin compliance, Blue UAS framework, FPV NDAA compliance, Freefly compliance PDF',
    ),
    'compliance-matrix.html': (
        'Drone Compliance Matrix - 848, 889, ASDA, Blue UAS, FCC',
        'Side-by-side reference for drone compliance regimes: NDAA 848, 889, 817, ASDA / FAR 52.240-1, Blue UAS Cleared, Blue UAS Framework, TAA, and FCC Covered List. Effective dates, scope, and citations.',
        'NDAA 848 vs ASDA, FAR 52.240-1, Blue UAS vs NDAA, FCC covered list drones, drone compliance explainer',
    ),
    'dossier.html': (
        'Manufacturer Dossier - Drone Vendor Due Diligence',
        'One-page dossier per drone vendor. Status, M&A history, corporate family, leadership, parts in the Forge DB, §848 spec sheets, alternatives graph, risk flags, and replacement suggestions. Built for defense procurement officers and integrators doing vendor due diligence.',
        'drone manufacturer due diligence, UAS vendor dossier, drone company status, NDAA vendor check, Blue UAS vendor profile, drone supply chain intelligence',
    ),
    'timeline.html': (
        'Regulatory Timeline - US UAS Compliance Milestones',
        'Chronological ledger of US UAS compliance and regulatory milestones: NDAA §848, §817, ASDA / FAR 52.240-1, Blue UAS Cleared List, FCC equipment ban, and major M&A events shaping the procurement landscape.',
        'UAS regulatory timeline, NDAA 848 timeline, ASDA effective date, FCC drone ban, Blue UAS history, drone compliance history',
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
    'support.html': (
        'Support Hub — Forge Drone Tools & Resources',
        'RF planning tools, PID tuning, build diagnostics, compliance audits, and learning guides for FPV and UAS builders. All Forge support resources in one place.',
        'drone tools, FPV support, RF range calculator, PID tuning tool, NDAA compliance audit, build troubleshooter, drone guides',
    ),
    'gallery.html': (
        'Featured Builds — NDAA-Compliant Reference Drone Builds',
        'Hand-curated NDAA-compliant FPV and UAS reference builds. Open any build directly in the Forge Model Builder to customize, clone, or price out your own version.',
        'NDAA drone build, FPV reference build, compliant drone components, TBS, Lumenier, Orqa, CubePilot, ISR drone, cinelifter, long range FPV',
    ),
    'entity-graph.html': (
        'Entity Graph — UAS Manufacturer & Program Network',
        'Interactive force-directed graph of UAS manufacturers, defense programs, contracts, and supply chain relationships. Explore connections across 1,200+ entities.',
        'UAS entity graph, drone manufacturer network, defense program relationships, supply chain graph, NDAA contractor map, drone industry connections',
    ),
    'guide.html': (
        'Build Guide — Step-by-Step Drone Assembly',
        'Step-by-step drone assembly instructions with photo capture, 3D STL viewer, media carousel, and build session tracking.',
        'drone build guide, FPV assembly instructions, drone wiring guide, step by step drone build',
    ),
    'editor.html': (
        'Parts Library — __PART_COUNT__+ Vetted Drone Components',
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
        'Browse the complete catalog of __PART_COUNT__+ drone components with search, filtering, and detailed specifications.',
        'drone parts catalog, browse FPV parts, drone component search',
    ),
    'clock.html': (
        'UAS Ecosystem Clock — How Close Is the US Drone Industry to Midnight?',
        'Live threat assessment for the US drone supply chain. Tracks NDAA compliance gaps, gray zone vendors, regulatory pressure, and procurement velocity. Updated daily by the P.I.E. pipeline.',
        'UAS ecosystem clock, drone supply chain risk, NDAA compliance tracker, gray zone drones, Blue UAS threat assessment, drone industry intelligence',
    ),
    'patterns.html': (
        'P.I.E. Pattern Intelligence — Drone Supply Chain Flags & Predictions',
        'Live PIE flags, predictions, and gray zone entity tracking for the US drone industry. 250+ active signals across supply chain, regulatory, and procurement vectors.',
        'drone supply chain intelligence, PIE flags, NDAA procurement signals, gray zone drones, drone industry predictions, UAS threat assessment',
    ),
    'patterns-home.html': (
        'P.I.E. Pattern Intelligence Engine — Drone Industry Threat Assessment',
        'The Pattern Intelligence Engine tracks supply chain concentration, gray zone vendors, regulatory pressure, and procurement signals across the US UAS ecosystem.',
        'drone intelligence platform, PIE engine, UAS supply chain, drone procurement intelligence, NDAA threat tracking',
    ),
    'brief.html': (
        'Daily PIE Brief — UAS Ecosystem Intelligence Report',
        'Daily AI-synthesized intelligence brief covering drone supply chain signals, gray zone entity activity, regulatory developments, and procurement velocity.',
        'drone intelligence brief, daily UAS report, PIE brief, drone supply chain news, NDAA procurement signals',
    ),
    'analytics.html': (
        'Mission Control — Forge Analytics Dashboard',
        'Analytics dashboard for the Forge ecosystem. Wingman query patterns, parts database health, intel source velocity, and user signals.',
        'drone analytics dashboard, Forge mission control, UAS intelligence analytics',
    ),
    'ddg.html': (
        'Defense Drone Gauntlet Tracker — G-I & G-II Program Analysis',
        'Live tracker for the Defense Drone Gauntlet (DDG) program. Competitor scoring, NDAA compliance posture, production readiness, funding depth, and G-II phase predictions for all 8 awardees.',
        'Defense Drone Gauntlet, DDG program, drone procurement, NDAA compliant drones, DoD drone competition, G-I G-II tracker',
    ),
    'private/components-bom.html': (
        'Component BOMs — DDG Platform Bill-of-Materials (Private)',
        'Gated, best-effort per-platform bill-of-materials reconstruction for Drone Dominance / Gauntlet participant platforms, inverted from confidence-tagged OSINT supply-chain links.',
        'DDG component BOM, drone bill of materials, supply chain intelligence, platform teardown',
    ),
    'private/drone-config.html': (
        'Build Configurator — Constraint-Driven Auto-Builder (Private)',
        'Gated parts auto-builder: set prop class, battery, payload and a flight-time target to get a compatibility-valid component build with estimated thrust-to-weight and endurance.',
        'drone build configurator, auto-builder, FPV component selector, thrust to weight, flight time estimator',
    ),
    'waiver.html': (
        'Drone Document Builder — Part 107, COI, Ops Manuals & More',
        'Generate drone operations documents: Part 107 Ops Manual, Certificate of Insurance summary, Drone Services Agreement, Property Access, Incident Report, Client NDA, and DFR-specific templates.',
        'drone document builder, Part 107 operations manual, drone COI, drone services agreement, DFR documents, UAS legal templates',
    ),
    'stack-builder.html': (
        'Drone Stack Builder — FC + ESC + Motor Compatibility Checker',
        'Build a complete drone stack from verified components. Real-time compatibility validation across flight controller, ESC, motor, propeller, and battery combinations.',
        'drone stack builder, FC ESC compatibility, drone parts selector, FPV build tool, motor ESC combo',
    ),
    'payload-compare.html': (
        'Drone Payload Comparison Tool — NDAA-Compliant Platforms',
        'Compare payload capacity, flight time, and mission profiles across 219 drone platforms. Filter by Blue UAS clearance, payload weight, thermal capability, and NDAA compliance.',
        'drone payload comparison, Blue UAS payload, NDAA drone specs, drone mission planner, UAS payload capacity',
    ),
    'tracker.html': (
        'UAS Program Tracker — DoD Contracts & Platform Status',
        'Track active DoD and federal UAS procurement programs, contract awards, platform lifecycle status, and Blue UAS framework adoption across agencies.',
        'UAS program tracker, DoD drone contracts, drone procurement tracker, Blue UAS adoption, federal drone programs',
    ),
    'regs.html': (
        'Drone Regulations Reference — Part 107, NDAA, FCC Covered List',
        'Searchable reference for drone regulations: FAA Part 107, NDAA Sections 848/817/1821, FCC Covered List, ASDA/FAR 52.240-1, ITAR, and state-level drone laws.',
        'drone regulations, FAA Part 107, NDAA 848, FCC covered list drones, drone law reference, UAS regulations',
    ),
    'verify.html': (
        'NDAA Compliance Verifier — Check Drone & Component Status',
        'Verify NDAA compliance status for drone platforms and components. Cross-reference FCC Covered List, Blue UAS Framework, NDAA Section 848, and country-of-origin data.',
        'NDAA compliance check, drone compliance verifier, FCC covered list lookup, Blue UAS status, drone NDAA status',
    ),
    'report.html': (
        'Drone Intelligence Report Generator — PIE Briefing Tool',
        'Generate custom drone industry intelligence reports from PIE flag data. Export procurement signals, supply chain analysis, and gray zone entity summaries.',
        'drone intelligence report, PIE briefing, drone procurement report, UAS supply chain analysis, NDAA compliance report',
    ),
    'start.html': (
        'Get Started with Forge — Drone Intelligence Platform',
        'Start using Forge: browse 3,700+ vetted drone parts, check NDAA compliance, build your stack, access PIE intelligence flags, and chat with Wingman AI.',
        'drone intelligence platform, Forge onboarding, drone parts database, NDAA compliance tool, FPV build planner',
    ),
    'grants.html': (
        'SBIR/STTR Grants Tracker — Drone & UAS Funding',
        'Track active SBIR and STTR grants for drone and UAS technology development. Filter by agency, phase, topic area, and award amount.',
        'SBIR drone grants, STTR UAS funding, drone R&D grants, DoD drone SBIR, UAS technology funding',
    ),
    'forge-home.html': (
        'Forge — Drone Build Hub, Parts Database & Compliance Toolkit',
        'The Forge hub: 3,500+ vetted drone components, 272 platforms, a build planner with a 12-check compatibility engine, NDAA compliance tools, and integration guides for FPV, commercial, and defense UAS.',
        'drone parts database, UAS build planner, NDAA compliance, drone component browser, FPV parts, Blue UAS platforms',
    ),
    'vault.html': (
        'Forge Vault — Combat & Gray-Area UAS Components',
        'Restricted access database of 580+ combat, tactical, and gray-area drone components including MAFIA FPV, Ukrainian wartime hardware, and loitering munition subsystems.',
        'combat drone parts, FPV wartime components, MAFIA drone, Ukrainian FPV, loitering munition components',
    ),
    'intel-commercial.html': (
        'Commercial Intel Feed — UAS Industry News & Signals',
        'Commercial drone intelligence: funding rounds, M&A activity, product launches, market signals, and supply chain developments across the civilian UAS sector.',
        'commercial drone news, UAS industry intelligence, drone funding, FPV market signals, drone M&A',
    ),
    'intel-dfr.html': (
        'DFR Intel Feed — Drone as First Responder Programs',
        'Intelligence feed for Drone as First Responder programs: public safety procurement, DFR platform deployments, regulatory approvals, and agency adoption.',
        'drone first responder, DFR program, public safety drone, police drone procurement, DFR platform',
    ),
    'contribute.html': (
        'Contribute to Forge — Submit Parts & Intelligence',
        'Submit new drone parts, flag incorrect data, or contribute intelligence to the Forge database. Community submissions are reviewed and merged into the vetted parts database.',
        'contribute drone parts, Forge community, drone database submission, FPV parts database, drone intelligence contribution',
    ),
    'tools-home.html': (
        'Forge Tools — FPV Calculators, RF Planners & More',
        'Suite of drone and FPV tools: PID calculator, RF channel planner, range estimator, firmware target matcher, VTX frequency planner, and antenna length calculator.',
        'drone tools, FPV calculator, RF channel planner, PID tuning tool, drone range calculator, VTX planner',
    ),
    'software-library.html': (
        'Software Library — Drone & UAS Tools — Forge',
        'Every configurator, GCS, simulator, and firmware tool for FPV, commercial UAS, and defense platforms. Betaflight, QGroundControl, Mission Planner, ELRS, and 40+ more with direct download links.',
        'drone software, FPV configurator, ground control station, Betaflight configurator, ELRS configurator, Mission Planner, QGroundControl, drone tools download',
    ),
    'lexicon.html': (
        'Estimative Language — How PIE Expresses Confidence & Likelihood',
        'The fixed lexicon behind every PIE flag, prediction, and brief judgment: evidence tiers, ICD 203-style likelihood bands, confidence levels, and source types.',
        'estimative language, intelligence confidence levels, ICD 203, PIE methodology, analytic standards, likelihood scale',
    ),
    'api-docs.html': (
        'Data API — Machine-Readable PIE Intelligence & Forge Datasets',
        'Free JSON API for PIE flags, the daily brief, predictions, trends, entity graph, and the Forge parts database. One endpoint, no key, refreshed daily.',
        'drone intelligence API, PIE flags JSON, UAS supply chain data API, drone parts database API, open intelligence data',
    ),
    'privacy.html': (
        'Privacy Policy — Forge Drone Intelligence Platform',
        'Forge privacy policy. No cookies, no PII collection, no tracking. Analytics are anonymized session data only.',
        'Forge privacy policy, drone platform privacy, no tracking, anonymous analytics',
    ),
    'terms.html': (
        'Terms of Service — Forge Drone Intelligence Platform',
        'Terms of service for the Forge drone intelligence platform, including data usage and acceptable use policy.',
        'Forge terms of service, drone platform terms',
    ),
    'template.html': (
        'Forge — Page Template',
        'Forge drone intelligence platform.',
        'Forge drone platform',
    ),
}

DEFAULT_SEO = (
    'Forge — Drone Integration Handbook',
    'Interactive build planner and intelligence platform for the Drone Integration Handbook. __PART_COUNT__+ parts, 219 platforms, compliance tracking.',
    'drone build planner, FPV parts, drone intelligence platform',
)


def inject_seo(html, src_name, dst_path):
    """Inject meta description, Open Graph, Twitter Card, and canonical URL."""
    title, description, keywords = SEO_META.get(src_name, DEFAULT_SEO)

    # Substitute __PART_COUNT__ placeholder with the live count from the DB,
    # rounded down to the nearest 100 so the public number doesn't churn on
    # every commit. SEO copy used to hardcode "3,500+" — drifted ~400 behind
    # the real figure (currently ~3,885 components in 34 categories).
    if _PART_COUNT_PLACEHOLDER in title or _PART_COUNT_PLACEHOLDER in description:
        rounded = max(100, (_get_part_count() // 100) * 100)
        count_str = f"{rounded:,}"
        title = title.replace(_PART_COUNT_PLACEHOLDER, count_str)
        description = description.replace(_PART_COUNT_PLACEHOLDER, count_str)

    clean_path = dst_path.replace('index.html', '')
    # Patterns + Intel pages both live on uas-patterns.com (intel merged into
    # patterns — no separate uas-intel.com site, no separate .pro site).
    # Main Forge tooling lives on uas-forge.com. Legacy nvmill*/uas-intel.com
    # domains 301 → new ones across (see _redirects).
    CANONICAL_OVERRIDES = {
        # UAS- hub — cross-domain landing page, canonical on uas-forge.com
        'hub/':            'https://uas-forge.com/hub/',
        # Patterns flags dashboard — on uas-patterns.com (Pro merged)
        'patterns/':       'https://uas-patterns.com/patterns/',
        # Patterns free / public — uas-patterns.com
        'patterns-home/':  'https://uas-patterns.com/patterns-home/',
        'clock/':          'https://uas-patterns.com/clock/',
        'ddg/':            'https://uas-patterns.com/ddg/',
        'brief/':          'https://uas-patterns.com/brief/',
        'analytics/':      'https://uas-patterns.com/analytics/',
        'lexicon/':        'https://uas-patterns.com/lexicon/',
        'api-docs/':       'https://uas-patterns.com/api-docs/',
        # Intel — merged into uas-patterns.com
        'intel/':              'https://uas-patterns.com/intel/',
        'intel/feed/':         'https://uas-patterns.com/intel/feed/',
        'intel-commercial/':   'https://uas-patterns.com/intel-commercial/',
        'intel-dfr/':          'https://uas-patterns.com/intel-dfr/',
        'industry/':           'https://uas-patterns.com/industry/',
        'tracker/':            'https://uas-patterns.com/tracker/',
        'timeline/':           'https://uas-patterns.com/timeline/',
        # Main Forge — uas-forge.com
        'forge/':              'https://uas-forge.com/forge/',
        'browse/':             'https://uas-forge.com/browse/',
        'builder/':            'https://uas-forge.com/builder/',
        'compare/':            'https://uas-forge.com/compare/',
        'compliance/':         'https://uas-forge.com/compliance/',
        'compliance-matrix/':  'https://uas-forge.com/compliance-matrix/',
        'cost/':               'https://uas-forge.com/cost/',
        'payload-compare/':    'https://uas-forge.com/payload-compare/',
        'platforms/':          'https://uas-forge.com/platforms/',
        'stack-builder/':      'https://uas-forge.com/stack-builder/',
        'circuit-forge/':      'https://uas-forge.com/circuit-forge/',
        'spec-sheets/':        'https://uas-forge.com/spec-sheets/',
        'dossier/':            'https://uas-forge.com/dossier/',
        'grants/':             'https://uas-forge.com/grants/',
        'regs/':               'https://uas-forge.com/regs/',
        'verify/':             'https://uas-forge.com/verify/',
        'audit/':              'https://uas-forge.com/audit/',
        'report/':             'https://uas-forge.com/report/',
        'waiver/':             'https://uas-forge.com/waiver/',
        'wingman/':            'https://uas-forge.com/wingman/',
        'tools/':              'https://uas-forge.com/tools/',
        'tools-home/':         'https://uas-forge.com/tools-home/',
        'software-library/':   'https://uas-forge.com/software-library/',
        'pid-tuning/':         'https://uas-forge.com/pid-tuning/',
        'guides/':             'https://uas-forge.com/guides/',
        'guide/':              'https://uas-forge.com/guide/',
        'swarm/':              'https://uas-forge.com/swarm/',
        'swarm-guide/':        'https://uas-forge.com/swarm-guide/',
        'slam/':               'https://uas-forge.com/slam/',
        'slam-guide/':         'https://uas-forge.com/slam-guide/',
        'mesh-guide/':         'https://uas-forge.com/mesh-guide/',
        'tak-guide/':          'https://uas-forge.com/tak-guide/',
        'openhd-guide/':       'https://uas-forge.com/openhd-guide/',
        'ai-guide/':           'https://uas-forge.com/ai-guide/',
        'cuas-guide/':         'https://uas-forge.com/cuas-guide/',
        'fc-firmware-guide/':  'https://uas-forge.com/fc-firmware-guide/',
        'academy/':            'https://uas-forge.com/academy/',
        'support/':            'https://uas-forge.com/support/',
        'start/':              'https://uas-forge.com/start/',
        'library/':            'https://uas-forge.com/library/',
        'vault/':              'https://uas-forge.com/vault/',
        'contribute/':         'https://uas-forge.com/contribute/',
    }
    canonical = CANONICAL_OVERRIDES.get(clean_path, f'{SITE_URL}/{clean_path}')

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

    <!-- Open Graph Image -->
    <meta property="og:image" content="https://uas-forge.com/static/og-image.png">
    <meta name="twitter:image" content="https://uas-forge.com/static/og-image.png">

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
        'circuit-forge.html': '0.8',
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

# All component categories supported by the Forge schema
COMPONENT_CATEGORIES = [
    'frames', 'motors', 'servos', 'stacks', 'flight_controllers', 'escs', 
    'aio_boards', 'pdbs', 'voltage_regulators', 'batteries', 'battery_chargers', 
    'propellers', 'fpv_cameras', 'digital_video_cameras', 'thermal_cameras', 
    'action_cameras', 'video_transmitters', 'fpv_goggles', 'antennas', 
    'ground_antennas', 'receivers', 'transmitters', 'rf_modules', 'gps_modules', 
    'optical_flow_sensors', 'rangefinders', 'capacitors', 'buzzers', 'led_strips', 
    'connector_adapters', 'wiring_hardware', 'tools', 'accessories'
]


def sync_handbook_data():
    """Clone the Ai-Project repo and assemble forge_database.json from its parts-db."""
    print("Ã¢ÂÂ" * 50)
    print("  Syncing data from Ai-Project...")
    print("Ã¢ÂÂ" * 50)

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
        ['git', '-C', DATA_CLONE_DIR, 'sparse-checkout', 'set', '--no-cone',
         '/data/parts-db/', '/docs/database/',
         '/scripts/validate_forge_database.py', '/data/forge_database.schema.json'],
        capture_output=True, text=True
    )

    parts_dir = os.path.join(DATA_CLONE_DIR, 'data', 'parts-db')
    if not os.path.isdir(parts_dir):
        print(f"  WARNING: {parts_dir} not found after clone")
        print("  Falling back to local forge_database.json")
        return False

    # Pull the structural validator from the cloned Ai-Project — canonical
    # source, no file duplication. Falls back to a no-op if the script isn't
    # present (e.g. older Ai-Project commits before f396656). The validator
    # is stdlib-only so no pip install needed at Netlify build time.
    _forge_validator = None
    _validator_src = os.path.join(DATA_CLONE_DIR, 'scripts', 'validate_forge_database.py')
    if os.path.isfile(_validator_src):
        try:
            import importlib.util as _ilu
            _spec = _ilu.spec_from_file_location('forge_db_validator', _validator_src)
            _forge_validator = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_forge_validator)
            print(f"  validator: loaded {_validator_src}")
        except Exception as _e:
            print(f"  WARNING: validator import failed: {_e}")
            _forge_validator = None
    else:
        print("  WARNING: validate_forge_database.py not in clone — skipping pre/post validation")

    # Load existing forge_database.json for industry data (stays local)
    local_db_path = os.path.join(SRC_DIR, 'forge_database.json')
    with open(local_db_path, 'r', encoding='utf-8') as f:
        forge_db = json.load(f)

    # Pre-merge: validate the local DB BEFORE we touch it. A corrupt local
    # fallback (missing components, malformed drone_models) would otherwise
    # silently produce a broken merged result that then ships to production.
    if _forge_validator is not None:
        try:
            warnings = _forge_validator.validate(forge_db, source_path=local_db_path)
            print(f"  validator (pre-merge): forge_database.json passed; {len(warnings)} soft warning(s)")
        except _forge_validator.ValidationError as _e:
            print(f"  ERROR: local forge_database.json failed validation: {_e}")
            print("  Refusing to merge into a structurally broken database — aborting sync")
            return False

    # Sync EVERY component category present in parts-db — never a hardcoded
    # allowlist. The previous static COMPONENT_CATEGORIES list (25 categories)
    # silently froze the site's coverage while parts-db — and the canonical
    # forge-data mirror built from it by Ai-Project/scripts/merge-forge-data.py —
    # carried far more. That under-reported the catalog (the site showed
    # 4,093 parts / 34 categories against the canonical 4,210 / 43) and let the
    # two surfaces drift apart. Discover categories dynamically so the site and
    # forge-data can never diverge on category coverage again.
    #
    # Files in parts-db that are NOT component categories and must be skipped:
    #   drone_models / build_guides  — surfaced separately (platforms, guides)
    #   platform_images              — a platform→image asset lookup (a dict)
    #   drone_parts_schema_v3        — the schema, not data
    # Any other non-list file is treated as an asset and skipped too.
    NON_COMPONENT_FILES = {
        'drone_models', 'build_guides', 'platform_images', 'drone_parts_schema_v3',
    }
    discovered = []
    for fname in sorted(os.listdir(parts_dir)):
        if not fname.endswith('.json'):
            continue
        stem = fname[:-5]
        if stem in NON_COMPONENT_FILES:
            continue
        with open(os.path.join(parts_dir, fname), 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, list):
            continue  # asset / lookup file, not a component category
        # MERGE: handbook data wins for existing entries, but keep local-only entries
        handbook_names = {e.get('name', '').lower() for e in data}
        local_only = [e for e in forge_db['components'].get(stem, [])
                      if e.get('name', '').lower() not in handbook_names]
        forge_db['components'][stem] = data + local_only
        discovered.append(stem)
        print(f"  {stem}: {len(data)} from handbook + {len(local_only)} local-only = {len(forge_db['components'][stem])}")
    print(f"  → {len(discovered)} component categories discovered from parts-db (no allowlist)")

    # Anti-drift gate: the merged catalog must carry AT LEAST every parts-db
    # component record (>= because curated local-only entries are additive).
    # If it carries fewer, a category was dropped or a merge bug ate records —
    # fail the sync rather than silently ship a short catalog and let the site
    # under-report itself against the canonical forge-data mirror again.
    parts_db_component_total = 0
    parts_db_component_cats = 0
    for fname in os.listdir(parts_dir):
        if not fname.endswith('.json') or fname[:-5] in NON_COMPONENT_FILES:
            continue
        with open(os.path.join(parts_dir, fname), 'r', encoding='utf-8') as f:
            _d = json.load(f)
        if isinstance(_d, list):
            parts_db_component_total += len(_d)
            parts_db_component_cats += 1
    merged_component_total = sum(len(v) for v in forge_db['components'].values())
    if (len(forge_db['components']) < parts_db_component_cats
            or merged_component_total < parts_db_component_total):
        print(f"  ERROR: catalog parity drift — merged "
              f"{merged_component_total} parts / {len(forge_db['components'])} categories "
              f"< parts-db {parts_db_component_total} / {parts_db_component_cats}. "
              f"Refusing to ship a short catalog.")
        shutil.rmtree(DATA_CLONE_DIR, ignore_errors=True)
        return False
    print(f"  parity OK: {merged_component_total} parts / {len(forge_db['components'])} "
          f"categories ≥ parts-db {parts_db_component_total} / {parts_db_component_cats}")

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

    # Post-merge: validate the merged result BEFORE we overwrite the local DB.
    # A bad merge (field rename in parts-db that drops names, etc.) would
    # otherwise stomp on a working forge_database.json with broken data and
    # the next build would have nothing to fall back to.
    if _forge_validator is not None:
        try:
            warnings = _forge_validator.validate(forge_db, source_path='<merged>')
            print(f"  validator (post-merge): merged DB passed; {len(warnings)} soft warning(s)")
        except _forge_validator.ValidationError as _e:
            print(f"  ERROR: merged forge_database.json failed validation: {_e}")
            print("  Refusing to overwrite the local DB with broken merged data — keeping previous version")
            shutil.rmtree(DATA_CLONE_DIR, ignore_errors=True)
            return False

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


def sync_private_dossiers():
    """Pull the OSINT dossiers from the PRIVATE Ai-Project repo into
    build/private/dossiers/ at build time. The markdown is NEVER committed to
    this (forge) repo — it only exists in the gated build output, served behind
    Cloudflare Access (/private/*). Source resolution:
      1. sibling checkout ../Ai-Project/research (local/dev), else
      2. shallow clone via GITHUB_PAT (CI).
    If neither is available, the dossier viewer degrades to its 404 message.
    """
    import glob, tempfile
    print("  Syncing private dossiers from Ai-Project...")
    research = None
    sibling = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'Ai-Project', 'research')
    tmp_clone = None
    if os.path.isdir(sibling):
        research = sibling
        print("    using sibling ../Ai-Project/research")
    else:
        pat = os.environ.get('GITHUB_PAT', '')
        if not pat:
            print("    SKIP: no sibling checkout and no GITHUB_PAT — dossiers omitted from build")
            return False
        tmp_clone = tempfile.mkdtemp(prefix='aiproj_')
        url = DATA_REPO.replace('https://', f'https://x-access-token:{pat}@')
        # On a Pages preview build, prefer the matching Ai-Project branch (e.g.
        # the dossiers live on a feature branch before PR merge). CF sets
        # CF_PAGES_BRANCH; AI_PROJECT_REF is a manual override. Fall back to the
        # repo default branch (production / merged state).
        refs = []
        for r in (os.environ.get('AI_PROJECT_REF'), os.environ.get('CF_PAGES_BRANCH')):
            r = (r or '').strip()
            if r and r not in refs:
                refs.append(r)
        refs.append(None)  # repo default branch, tried last (production state)
        print(f"    dossier clone refs (in order): {[r or 'default' for r in refs]}")
        cloned = False
        for ref in refs:
            cmd = ['git', 'clone', '--depth', '1', '--filter=blob:none']
            if ref:
                cmd += ['--branch', ref]
            try:
                subprocess.run(cmd + [url, tmp_clone],
                               check=True, capture_output=True, text=True, timeout=180)
                research = os.path.join(tmp_clone, 'research')
                print(f"    cloned Ai-Project ref={ref or 'default'}")
                cloned = True
                break
            except Exception as e:
                msg = (getattr(e, 'stderr', '') or str(e)).strip().splitlines()[-1:] or ['']
                print(f"    ref={ref or 'default'} not usable ({msg[0]})")
                shutil.rmtree(tmp_clone, ignore_errors=True)
                tmp_clone = tempfile.mkdtemp(prefix='aiproj_')
        if not cloned:
            print("    SKIP: clone failed for all refs — dossiers omitted")
            shutil.rmtree(tmp_clone, ignore_errors=True)
            return False

    out_dir = os.path.join(BUILD_DIR, 'private', 'dossiers')
    os.makedirs(out_dir, exist_ok=True)
    SKIP = {'_TEMPLATE.md', 'README.md'}

    def title_of(path):
        try:
            for line in open(path, encoding='utf-8'):
                if line.startswith('# '):
                    return line[2:].split('—')[0].strip()
        except Exception:
            pass
        return os.path.basename(path)[:-3]

    # (source glob, output slug-prefix, group label)
    specs = [
        (os.path.join(research, 'profiles', '*.md'), '', 'Company dossiers'),
        (os.path.join(research, 'ddg_supply_chain_intel.md'), '', 'Cross-cutting'),
        (os.path.join(research, 'ddg_deep_dig.md'), '', 'Cross-cutting'),
    ]
    index, n = [], 0
    seen = set()
    for pattern, _pref, group in specs:
        for src in sorted(glob.glob(pattern)):
            fn = os.path.basename(src)
            if fn in SKIP or fn in seen:
                continue
            seen.add(fn)
            slug = fn[:-3]
            shutil.copy2(src, os.path.join(out_dir, fn))
            g = 'Cross-cutting' if fn in ('ddg2-roster.md',) else group
            index.append({'slug': slug, 'title': title_of(src), 'group': g})
            n += 1
    # sort: Company dossiers first (alpha), Cross-cutting last
    index.sort(key=lambda d: (d['group'] != 'Company dossiers', d['title'].lower()))
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, separators=(',', ':'))

    # Also pull the structured supplier->platform web that drives the gated
    # /private/supply-web/ visual. Same gate, same never-committed rule.
    repo_root = os.path.dirname(research.rstrip('/'))
    supply_src = os.path.join(repo_root, 'data', 'ddg_supply_links.json')
    if os.path.isfile(supply_src):
        priv_dir = os.path.join(BUILD_DIR, 'private')
        os.makedirs(priv_dir, exist_ok=True)
        shutil.copy2(supply_src, os.path.join(priv_dir, 'supply_links.json'))
        print("    Copied ddg_supply_links.json to build/private/supply_links.json")
    else:
        print("    NOTE: data/ddg_supply_links.json not found — supply-web page will show empty state")

    # Pull the genuinely-private Ai-Project datasets (never on public /api/data)
    # into build/private/data/ for the gated Intel Data browser. Each entry:
    #   (source path under the repo, output filename, label, one-line description)
    PRIVATE_DATASETS = [
        ('data/gur_teardowns.json', 'gur_teardowns.json', 'GUR Teardowns (raw)',
         'Raw adversary teardown BOMs — the source the public Adversary BOM lens is derived from.'),
        ('data/ownership_graph.json', 'ownership_graph.json', 'Ownership Graph',
         'Who-owns-who semiconductor acquisition chains behind drone silicon.'),
        ('data/component_platform_map.json', 'component_platform_map.json', 'Component → Platform Map',
         'Which components sit inside which platforms (feeds the mirroring index).'),
        ('data/grayzone/entities.json', 'grayzone_entities.json', 'Gray-Zone Entities',
         'Gray-zone actor tracking — entities under watch.'),
        ('data/grayzone/risk_scores.json', 'grayzone_risk_scores.json', 'Gray-Zone Risk Scores',
         'Risk scoring for tracked gray-zone entities.'),
        ('data/grayzone/indicators.json', 'grayzone_indicators.json', 'Gray-Zone Indicators',
         'Indicators feeding the gray-zone risk model.'),
        ('data/intel-db/vendor_pricing_flir_czi.json', 'vendor_pricing_flir_czi.json', 'Vendor Pricing — FLIR / CZI',
         'Collected vendor pricing intel (Teledyne FLIR / CZI).'),
        ('data/intel-db/vendor_pricing_skydio.json', 'vendor_pricing_skydio.json', 'Vendor Pricing — Skydio',
         'Collected vendor pricing intel (Skydio).'),
    ]
    data_out = os.path.join(BUILD_DIR, 'private', 'data')
    os.makedirs(data_out, exist_ok=True)
    data_index = []
    for rel, outname, label, desc in PRIVATE_DATASETS:
        src = os.path.join(repo_root, rel)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(data_out, outname))
            data_index.append({'file': outname, 'label': label, 'desc': desc,
                               'bytes': os.path.getsize(src)})
    with open(os.path.join(data_out, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(data_index, f, separators=(',', ':'))
    print(f"    Copied {len(data_index)}/{len(PRIVATE_DATASETS)} private datasets to build/private/data/")
    # Manufacturer-published / first-party per-platform BOM rows (same
    # supplier->feeds schema). Kept separate from ddg_supply_links.json so the
    # Supply Web graph stays third-party-only; the Component BOMs page merges both.
    pbom_src = os.path.join(repo_root, 'data', 'platform_boms.json')
    if os.path.isfile(pbom_src):
        priv_dir = os.path.join(BUILD_DIR, 'private')
        os.makedirs(priv_dir, exist_ok=True)
        shutil.copy2(pbom_src, os.path.join(priv_dir, 'platform_boms.json'))
        print("    Copied platform_boms.json to build/private/platform_boms.json")
    else:
        print("    NOTE: data/platform_boms.json not found — Component BOMs page falls back to supply_links only")
    if tmp_clone:
        shutil.rmtree(tmp_clone, ignore_errors=True)
    print(f"    Copied {n} dossiers + index.json to build/private/dossiers/")
    return True


def build():
    # Step 0: Sync data from handbook repo
    sync_handbook_data()

    # Step 0.5: SQLite integrity checks (warn-only, never blocks build)
    _db_path = os.path.join(SRC_DIR, 'forge_database.json')
    if os.path.exists(_db_path):
        try:
            _vr = subprocess.run(
                [sys.executable, os.path.join('tools', 'validate_db.py'), _db_path],
                capture_output=True, text=True, timeout=30,
            )
            for _line in (_vr.stdout or '').strip().split('\n'):
                if _line:
                    print(f"  {_line}")
            if _vr.returncode != 0 and _vr.stderr:
                print(f"  NOTE: validator exited {_vr.returncode}: {_vr.stderr.strip()[:200]}")
        except Exception as _e:
            print(f"  NOTE: SQLite validator skipped ({_e})")

    # Clean build directory
    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    
    os.makedirs(BUILD_DIR)
    os.makedirs(os.path.join(BUILD_DIR, 'static'))
    
    # Copy static assets — skip gated files (served by forge-data.mjs instead)
    copied = skipped = 0
    for fname in os.listdir(SRC_DIR):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in STATIC_EXTENSIONS:
            continue
        if fname in GATED_FROM_BUILD:
            skipped += 1
            continue
        src = os.path.join(SRC_DIR, fname)
        dst = os.path.join(BUILD_DIR, 'static', fname)
        # JS files (components.js, forge-static-adapter.js, …) fetch
        # forge_database.json by absolute path — bust it the same as the HTML
        # so they don't read a stale immutable-cached copy. Other assets copy
        # verbatim.
        if ext == '.js':
            with open(src, 'r', encoding='utf-8') as _f:
                _js = _f.read()
            with open(dst, 'w', encoding='utf-8') as _f:
                _f.write(add_db_cache_buster(_js))
        else:
            shutil.copy2(src, dst)
        copied += 1

    print(f"  Copied {copied} static assets, skipped {skipped} gated files")

    # Explicitly copy full intel files to build root (served at /pie_flags.json etc.)
    # These are NOT in /static/ — they live at root so authed users get full data
    ROOT_INTEL_FILES = ['flags.xml', 'brief.xml', 'pie_flags.json', 'pie_predictions.json', 'predictions_best.json',
                        'pie_brief.json', 'pie_trends.json', 'solicitations.json',
                        'intel_articles.json', 'intel_companies.json', 'intel_platforms.json',
                        'intel_programs.json', 'forge_intel.json', 'entity_graph.json',
                        # Patterns Hub lens artefacts — fetched as /adversary_bom.json etc.
                        'adversary_bom.json', 'component_mirroring_index.json',
                        'sanctions_evasion_graph.json', 'actor_fingerprints.json',
                        'ttp_counter_gap.json', 'threat_scores.json',
                        'market_lens.json',
                        'prediction_outcomes.json', 'calibration_scores.json',
                        # Health + health history
                        'miner_health.json', 'miner_registry.json']
    for fname in ROOT_INTEL_FILES:
        src = os.path.join(SRC_DIR, fname)
        dst = os.path.join(BUILD_DIR, fname)
        if os.path.exists(src):
            shutil.copy2(src, dst)
    print(f"  Copied {len(ROOT_INTEL_FILES)} intel files to build root")

    # Master DB files — served at /data/<vertical>/<vertical>_master.json to
    # match the absolute fetch paths in intel.html (commit 799e568). Without
    # this, the Defense / DFR / Commercial tabs on Intel Feed 404 and stay
    # empty even after the function gating was removed.
    DATA_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
    for vertical in ('defense', 'commercial', 'dfr'):
        src_m = os.path.join(DATA_ROOT, vertical, f'{vertical}_master.json')
        dst_dir = os.path.join(BUILD_DIR, 'data', vertical)
        if os.path.exists(src_m):
            os.makedirs(dst_dir, exist_ok=True)
            shutil.copy2(src_m, os.path.join(dst_dir, f'{vertical}_master.json'))
    print('  Copied defense / commercial / dfr master files to build/data/')
    
    # Generate free-tier data slices (same data, truncated — for public build)
    try:
        import generate_free_tier
        import importlib
        importlib.reload(generate_free_tier)
        generate_free_tier.main([str(os.path.join(BUILD_DIR, 'static'))])
        print("  Free-tier data slices generated")
    except Exception as e:
        print(f"  WARNING: free-tier generation failed: {e}")

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
        html = strip_baked_analytics(html)
        html = fix_paths(html, depth)
        html = inject_seo(html, src_name, dst_path)
        # forge-static-adapter intercepts /api/* and returns [] for /api/data
        # Skip injection for PIE/intel pages that exclusively use /api/data
        _NO_ADAPTER = {
            'patterns.html','brief.html','patterns-home.html',
            'intel.html','intel-home.html',
            'intel-dfr.html','intel-commercial.html',
            'clock.html','entity-graph.html','analytics.html',
            'adversary-bom.html','mirroring.html','actors.html',
            'ttps.html','evasion.html',
            # Circuit Forge talks only to the live /api/wingman CF Worker; the
            # static adapter would intercept /api/* and return [] for it.
            'circuit-forge.html',
        }
        if src_name not in _NO_ADAPTER:
            html = inject_adapter(html, depth)
        html = inject_analytics(html, src_name)
        html = inject_disclaimer(html, src_name)
        # Generated "At a glance" brief on the dash.uas-forge.com intel surfaces
        # (computed summary + optional analyst narrative; see dash-brief.js). Bump
        # ?v= when dash-brief.js changes — /static/* is immutable-cached.
        # NOTE: patterns.html is intentionally excluded — its native brief panel
        # (renderBriefPanel → #brief-inner) already shows the same counts + analyst
        # summary, so injecting the card there just stacked a redundant duplicate.
        if src_name in {'tracker.html', 'patterns-home.html', 'clock.html'}:
            html = html.replace('</body>', '  <script defer src="/static/dash-brief.js?v=3"></script>\n</body>', 1)
        html = fix_nav_links(html, depth)
        html = rewrite_legacy_domains(html)
        
        with open(dst_file, 'w', encoding='utf-8') as f:
            f.write(html)
        
        print(f"  {src_name} Ã¢ÂÂ {dst_path}")
    
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
    
    # Redirect + header rules live in the repo root _redirects / _headers
    # (Cloudflare Pages format). Netlify config has been retired.
    
    # Summary
    total_files = sum(1 for _, _, files in os.walk(BUILD_DIR) for _ in files)
    total_size = sum(os.path.getsize(os.path.join(dp, f)) 
                     for dp, _, files in os.walk(BUILD_DIR) for f in files)
    
    print(f"\n{'Ã¢ÂÂ' * 50}")
    print(f"  Forge static build complete")
    print(f"  {total_files} files, {total_size / 1024 / 1024:.1f} MB")
    print(f"  Ready for: Cloudflare Pages (publish dir: build/)")
    print(f"{'Ã¢ÂÂ' * 50}")

    # Ã¢ÂÂÃ¢ÂÂ Post-build count validation Ã¢ÂÂÃ¢ÂÂ
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
            print(f"  Ã¢ÂÂ  MISMATCH: components {src_parts} (source) vs {build_parts} (build)")
            ok = False
        if src_models != build_models:
            print(f"  Ã¢ÂÂ  MISMATCH: drone_models {src_models} (source) vs {build_models} (build)")
            ok = False
        if src_cats != build_cats:
            print(f"  Ã¢ÂÂ  MISMATCH: categories {src_cats} (source) vs {build_cats} (build)")
            ok = False
        if ok:
            print(f"  Ã¢ÂÂ Counts match: {src_parts} parts, {src_models} models, {src_cats} categories")


    # ── Cloudflare Pages routing files ──────────────────────────
    for cf_file in ['_redirects', '_routes.json', '_headers']:
        src_cf = os.path.join(os.path.dirname(os.path.abspath(__file__)), cf_file)
        dst_cf = os.path.join(BUILD_DIR, cf_file)
        if os.path.exists(src_cf):
            shutil.copy2(src_cf, dst_cf)
            print(f"  ✓ Copied {cf_file} to build/")

    # ── PRIVATE gated dossiers (pulled from Ai-Project; served behind Access) ──
    try:
        sync_private_dossiers()
    except Exception as e:
        print(f"  NOTE: private dossier sync skipped ({e})")


if __name__ == '__main__':
    build()
