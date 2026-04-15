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

# Pages to process  [rebuild 2026-04-10]
PAGES = {
    'index.html': 'builder/index.html',      # /builder/
    'mission-control.html': 'index.html',      # / (home — The Bench)
    'academy.html': 'academy/index.html',
    'support.html': 'support/index.html',
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
    'ddg.html': 'ddg/index.html',
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
    'software-library.html': 'software-library/index.html',
    'tracker.html': 'tracker/index.html',
    'grants.html': 'grants/index.html',
    'regs.html': 'regs/index.html',
    'verify.html': 'verify/index.html',
    'analytics.html': 'analytics/index.html',
    'clock.html': 'clock/index.html',
}

# Static assets to copy (JS, CSS, JSON, images)
STATIC_EXTENSIONS = {'.js', '.css', '.json', '.png', '.jpg', '.svg', '.ico', '.gif', '.webp'}

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
_ANALYTICS_SNIPPET = r"""(function(){var E=(location.hostname==='localhost'||location.hostname==='127.0.0.1'?'http://localhost:8888':'https://thebluefairy.netlify.app')+'/.netlify/functions/analytics-ingest',S='sess_'+crypto.randomUUID().replace(/-/g,'').slice(0,16),T=Date.now(),q=[],t=null,PG=typeof __FORGE_PAGE__!=='undefined'?__FORGE_PAGE__:'unknown';function reg(){try{var z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(z.includes('America'))return'Americas';if(z.includes('Europe'))return'Europe';if(z.includes('Asia')||z.includes('Australia')||z.includes('Pacific'))return'Asia-Pacific';if(z.includes('Africa'))return'Africa';}catch(e){}return'Unknown';}function ev(tp,ac,p){q.push({event_id:crypto.randomUUID(),timestamp:new Date().toISOString(),surface:'forge',page:PG,event_type:tp,event_action:ac,context:{session_id:S,geo_region:reg(),platform:/Android|iPhone|iPad/i.test(navigator.userAgent)?'mobile':'web',viewport:innerWidth+'x'+innerHeight,path:location.pathname},payload:p,data_policy:{collection_tier:'anonymous',retention_days:90,anonymized:true}});if(q.length>=20)fl();else if(!t)t=setTimeout(fl,5e3);}function fl(){if(t){clearTimeout(t);t=null;}if(!q.length)return;var b=q.splice(0);fetch(E,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:b}),keepalive:true}).catch(function(){});}ev('page_view','view',{path:location.pathname,title:document.title,page:PG,referrer:document.referrer?new URL(document.referrer).hostname:'direct'});var ds=[25,50,75,100],ht=new Set;addEventListener('scroll',function(){var pct=Math.round(scrollY/(Math.max(document.body.scrollHeight-innerHeight,1))*100),el=(Date.now()-T)/1e3;ds.forEach(function(d){if(pct>=d&&!ht.has(d)){ht.add(d);ev('engagement','scroll_depth',{path:location.pathname,depth_pct:d,time_sec:Math.round(el)});}});},{passive:true});document.addEventListener('click',function(e){var a=e.target.closest('a[href]');if(!a)return;try{var u=new URL(a.href);if(u.hostname!==location.hostname)ev('click','outbound_link',{from:location.pathname,to:u.hostname,text:a.textContent.trim().slice(0,80)});}catch(e){}});addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){ev('engagement','time_on_page',{path:location.pathname,duration_sec:Math.round((Date.now()-T)/1e3),deep_read:(Date.now()-T)>12e4});fl();}});addEventListener('pagehide',fl);window.__fa=window.__forgeAnalytics={search:function(q,cat,n){ev('search','component_search',{query:(q||'').slice(0,200),category:cat,result_count:n,had_results:n>0});if(!n)ev('search','no_results',{query:(q||'').slice(0,200),category:cat});},filter:function(cat,filters,n){ev('filter','apply_filter',{category:cat,filter_names:Object.keys(filters||{}),result_count:n,zero_results:!n});if(!n)ev('search','no_results',{query:'',category:cat,filters:filters});},view:function(pid,cat,mfr,country,ndaa){ev('page_view','component_detail',{pid:pid,category:cat,manufacturer:mfr,country:country,ndaa_compliant:ndaa});},compare:function(a,b,cat){ev('compare','side_by_side',{pid_a:a,pid_b:b,category:cat});},tab:function(name){ev('navigation','tab_switch',{tab:name,page:PG});},query:function(q,cat,img){ev('ai','wingman_query',{query:(q||'').slice(0,200),category:cat,has_image:!!img});},flag:function(id,sev,type){ev('intel','flag_view',{flag_id:id,severity:sev,flag_type:type});},intel:function(src,art){ev('intel','article_view',{source:src,article_id:art});},flush:fl};})();"""

# Page slug mapping — used to set __FORGE_PAGE__ per page
_PAGE_SLUGS = {
    'index.html': 'builder', 'mission-control.html': 'home',
    'patterns.html': 'patterns', 'patterns-home.html': 'patterns-home',
    'intel.html': 'intel-feed', 'intel-home.html': 'intel-home',
    'intel-defense.html': 'intel-defense', 'intel-commercial.html': 'intel-commercial',
    'intel-dfr.html': 'intel-dfr', 'intel-financial.html': 'intel-financial',
    'wingman.html': 'wingman', 'browse.html': 'browse',
    'platforms.html': 'platforms', 'compare.html': 'compare',
    'cost.html': 'cost', 'payload-compare.html': 'payload-compare',
    'stack-builder.html': 'stack-builder', 'industry.html': 'industry',
    'tools.html': 'tools', 'tools-home.html': 'tools-home',
    'software-library.html': 'software-library',
    'pro.html': 'pro', 'brief.html': 'brief', 'report.html': 'report',
    'compliance.html': 'compliance', 'tracker.html': 'tracker',
    'spec-sheets.html': 'spec-sheets', 'compliance-matrix.html': 'compliance-matrix',
    'dossier.html': 'dossier',
    'timeline.html': 'timeline',
    'regs.html': 'regs', 'verify.html': 'verify', 'waiver.html': 'waiver',
    'grants.html': 'grants', 'audit.html': 'audit', 'guide.html': 'guide',
    'pid-tuning.html': 'pid-tuning', 'academy.html': 'academy',
    'support.html': 'support',
    'guides-hub.html': 'guides-hub', 'swarm-guide.html': 'swarm-guide',
    'swarm-selector.html': 'swarm', 'slam-guide.html': 'slam-guide',
    'slam-selector.html': 'slam', 'mesh-guide.html': 'mesh-guide',
    'tak-guide.html': 'tak-guide', 'openhd-guide.html': 'openhd-guide',
    'ai-guide.html': 'ai-guide', 'cuas-guide.html': 'cuas-guide',
    'fc-firmware-guide.html': 'fc-firmware-guide', 'vault.html': 'vault',
    'troubleshoot.html': 'troubleshoot', 'start.html': 'start',
    'admin.html': 'admin', 'contribute.html': 'contribute',
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



_UNIFIED_NAV = r"""<!-- ── Unified DroneClear Nav ───────────────────────────────────────── -->
<style id="dc-unified-nav-styles">
#dc-nav{display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:44px;background:#0c0c0a;border-bottom:1px solid #1e1e18;position:sticky;top:0;z-index:500;font-family:'DM Sans',system-ui,sans-serif}
#dc-nav-left{display:flex;align-items:center;gap:10px;min-width:0}
#dc-nav-brand{font:700 13px 'JetBrains Mono',monospace;color:#f59e0b;text-decoration:none;letter-spacing:-.02em;flex-shrink:0}
#dc-nav-sep{color:#2e2e26;font-size:12px;flex-shrink:0}
#dc-nav-page{font:600 11px 'DM Sans',system-ui;color:#b8b0a0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}
#dc-nav-right{display:flex;align-items:center;gap:6px;flex-shrink:0}
.dc-nav-pill{font:500 10px 'DM Sans',system-ui;color:#6b6358;padding:4px 10px;border:1px solid #2a2a22;border-radius:20px;text-decoration:none;white-space:nowrap;transition:all .15s;display:none}
.dc-nav-pill:hover{border-color:#3e3e34;color:#b8b0a0}
.dc-nav-pill.dc-active{color:#22c55e;border-color:#22c55e;font-weight:700}
@media(min-width:540px){.dc-nav-pill{display:inline-flex}}
#dc-hamburger{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:6px;border:1px solid #2a2a22;background:none;color:#6b6358;cursor:pointer;transition:all .15s;flex-shrink:0}
#dc-hamburger:hover{border-color:#3e3e34;color:#b8b0a0}
#dc-hamburger.open{border-color:#f59e0b;color:#f59e0b;background:rgba(245,158,11,.08)}
#dc-overlay{position:fixed;inset:0;z-index:498;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .25s}
#dc-overlay.open{opacity:1;pointer-events:auto}
#dc-drawer{position:fixed;top:0;left:0;bottom:0;z-index:499;width:260px;max-width:85vw;background:#111110;border-right:1px solid #2a2a22;transform:translateX(-100%);transition:transform .3s cubic-bezier(.4,0,.2,1);display:flex;flex-direction:column;overflow-y:auto}
#dc-drawer.open{transform:translateX(0)}
#dc-drawer-head{padding:16px;border-bottom:1px solid #1e1e18;display:flex;align-items:center;justify-content:space-between}
#dc-drawer-brand{font:700 14px 'JetBrains Mono',monospace;color:#f59e0b;letter-spacing:-.02em}
#dc-drawer-close{width:28px;height:28px;border-radius:6px;border:1px solid #2a2a22;background:none;color:#6b6358;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s}
#dc-drawer-close:hover{color:#d62828;border-color:rgba(214,40,40,.3)}
.dc-drawer-section{padding:12px 16px 4px;font:700 9px 'JetBrains Mono',monospace;color:#3e3e34;text-transform:uppercase;letter-spacing:.1em}
.dc-drawer-item{display:flex;align-items:center;gap:10px;padding:9px 16px;color:#6b6358;text-decoration:none;font:400 12px 'DM Sans',system-ui;transition:all .15s;border-left:2px solid transparent}
.dc-drawer-item:hover{color:#b8b0a0;background:rgba(255,255,255,.02);border-left-color:#2e2e26}
.dc-drawer-item.dc-active{color:#22c55e;border-left-color:#22c55e;background:rgba(34,197,94,.04)}
.dc-drawer-item.dc-ext{color:#3e3e34}
.dc-drawer-item.dc-ext:hover{color:#6b6358}
.dc-drawer-divider{height:1px;background:#1e1e18;margin:8px 16px}
#dc-drawer-foot{margin-top:auto;padding:16px;border-top:1px solid #1e1e18;font:400 10px 'JetBrains Mono',monospace;color:#2e2e26}
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
    <!-- Forge pills -->
    <a class="dc-nav-pill dc-forge-pill" href="https://uas-forge.com/browse/" data-page="browse">Browse</a>
    <a class="dc-nav-pill dc-forge-pill" href="https://uas-forge.com/wingman/" data-page="wingman">Wingman</a>
    <a class="dc-nav-pill dc-forge-pill" href="https://uas-forge.com/intel/" data-page="intel">Intel</a>
    <!-- PIE pills -->
    <a class="dc-nav-pill dc-pie-pill" href="https://uas-patterns.com/clock/" data-page="clock">Clock</a>
    <a class="dc-nav-pill dc-pie-pill" href="https://uas-patterns.com/ddg/" data-page="ddg">DDG</a>
    <a class="dc-nav-pill dc-pie-pill" href="https://uas-patterns.pro/patterns/" data-page="patterns">Flags</a>
  </div>
</nav>

<div id="dc-overlay" onclick="dcNavClose()"></div>
<div id="dc-drawer">
  <div id="dc-drawer-head">
    <span id="dc-drawer-brand">—</span>
    <button id="dc-drawer-close" onclick="dcNavClose()">✕</button>
  </div>

  <div class="dc-drawer-section">Forge — Intelligence</div>
  <a class="dc-drawer-item" href="https://uas-forge.com/browse/" data-page="browse">Browse Components</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/compare/" data-page="compare">Compare</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/compliance/" data-page="compliance">Compliance</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/dossier/" data-page="dossier">Dossier</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/platforms/" data-page="platforms">Platforms</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/regs/" data-page="regs">Regs</a>

  <div class="dc-drawer-section">Forge — Tools</div>
  <a class="dc-drawer-item" href="https://uas-forge.com/wingman/" data-page="wingman">Wingman AI</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/stack-builder/" data-page="stack-builder">Stack Builder</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/report/" data-page="report">Compliance Report</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/support/" data-page="support">Support Hub</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/tools-home/" data-page="tools-home">All Tools</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/software-library/" data-page="software-library">Software Library</a>

  <div class="dc-drawer-section">Forge — Intel</div>
  <a class="dc-drawer-item" href="https://uas-forge.com/intel/" data-page="intel">Intel Hub</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/industry/" data-page="industry">Industry</a>
  <a class="dc-drawer-item" href="https://uas-forge.com/tracker/" data-page="tracker">Contract Tracker</a>

  <div class="dc-drawer-divider"></div>

  <div class="dc-drawer-section">PIE — Pattern Intelligence</div>
  <a class="dc-drawer-item" href="https://uas-patterns.com/patterns-home/" data-page="patterns-home">P.I.E Hub</a>
  <a class="dc-drawer-item" href="https://uas-patterns.com/brief/" data-page="brief">Brief</a>
  <a class="dc-drawer-item" href="https://uas-patterns.pro/patterns/" data-page="patterns">Flags</a>
  <a class="dc-drawer-item" href="https://uas-patterns.com/clock/" data-page="clock">UAS Clock</a>
  <a class="dc-drawer-item" href="https://uas-patterns.com/ddg/" data-page="ddg">DDG Tracker</a>

  <div class="dc-drawer-foot">Midwest Nice Advisory LLC</div>
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
  // Match both new uas-* domains and legacy nvmill* domains during transition.
  var isForge = host.includes('uas-forge') || host.includes('builditmyself') || host === 'localhost';
  var isPIE   = host.includes('uas-patterns') || host.includes('findoutmyself');

  // Set page label
  var labels = {
    'browse':'Browse','wingman':'Wingman','intel':'Intel Hub','compare':'Compare',
    'compliance':'Compliance','dossier':'Dossier','platforms':'Platforms','regs':'Regs',
    'stack-builder':'Stack Builder','report':'Compliance Report','tools-home':'Tools',
    'software-library':'Software Library',
    'industry':'Industry','tracker':'Contract Tracker','patterns-home':'P.I.E Hub',
    'brief':'Brief','patterns':'Flags','clock':'UAS Clock','ddg':'DDG Tracker',
    'pro':'Pro','start':'Getting Started','grants':'Grants','waiver':'Doc Builder',
    'verify':'Verify','vault':'Vault','troubleshoot':'Troubleshoot','support':'Support'
  };
  var pageEl = document.getElementById('dc-nav-page');
  if(pageEl) pageEl.textContent = labels[path] || document.title.split('—')[0].trim().split('·')[0].trim() || path;

  // Brand link — goes to home of current domain
  // Set brand name: Forge / Patterns / Patterns Pro
  var brandName = isForge ? 'Forge' : (isPIE && (isPro || path === 'pro')) ? 'Patterns Pro' : isPIE ? 'Patterns' : 'DroneClear';
  var brandEl = document.getElementById('dc-nav-brand');
  var drawerBrandEl = document.getElementById('dc-drawer-brand');
  if(brandEl){ brandEl.textContent = brandName; if(isPIE && isPro) brandEl.style.color='#a78bfa'; }
  if(drawerBrandEl){ drawerBrandEl.textContent = brandName; if(isPIE && isPro) drawerBrandEl.style.color='#a78bfa'; }

  window.dcNavBrandClick = function(e){
    e.preventDefault();
    location.href = isForge ? 'https://uas-forge.com/' : isPIE ? 'https://uas-patterns.com/patterns-home/' : '/';
  };

  // Show correct pills for domain, mark active
  var pills = document.querySelectorAll('.dc-nav-pill');
  pills.forEach(function(p){
    var isForgeP = p.classList.contains('dc-forge-pill');
    var isPIEP   = p.classList.contains('dc-pie-pill');
    if(isForge && isForgeP) p.style.display = 'inline-flex';
    if(isPIE   && isPIEP)   p.style.display = 'inline-flex';
    if(!isForge && !isPIE)  p.style.display = 'inline-flex'; // show all on unknown
    if(p.dataset.page === path) p.classList.add('dc-active');
  });

  // Mark active drawer items
  document.querySelectorAll('.dc-drawer-item').forEach(function(a){
    if(a.dataset.page === path) a.classList.add('dc-active');
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
  // Esc to close
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') dcNavClose(); });
})();
</script>
<!-- ── /Unified DroneClear Nav ─────────────────────────────────────── -->"""


def inject_nav(html, src_name):
    """Inject unified nav after <body> on every page except analytics and clock."""
    skip = {"analytics.html", "clock.html"}
    if src_name in skip:
        return html
    if "dc-unified-nav-styles" in html:
        return html  # already injected
    nav_block = "\n" + _UNIFIED_NAV + "\n"
    if "<body>" in html:
        return html.replace("<body>", "<body>" + nav_block, 1)
    return html

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
        html = html.replace("fetch('forge_intel.json')", f"fetch('{prefix}static/forge_intel.json')")
        html = html.replace("fetch('forge_troubleshooting.json')", f"fetch('{prefix}static/forge_troubleshooting.json')")
        html = html.replace("fetch('intel_articles.json')", "fetch('/.netlify/functions/forge-data?type=intel_articles&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
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
        html = html.replace("fetch('pie_flags.json')", "fetch('/.netlify/functions/forge-data?type=pie_flags&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
        html = html.replace("fetch('solicitations.json')", "fetch('/.netlify/functions/forge-data?type=solicitations&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
        html = html.replace("fetch('miner_registry.json')", f"fetch('{prefix}static/miner_registry.json')")
        html = html.replace('fetch("../static/miner_health.json")', f"fetch('{prefix}static/miner_health.json')")
        html = html.replace("fetch('miner_health.json')", f"fetch('{prefix}static/miner_health.json')")
        html = html.replace("fetch('/static/gap_analysis_latest.json')", f"fetch('{prefix}static/gap_analysis_latest.json')")
        html = html.replace("fetch('pie_predictions.json')", "fetch('/.netlify/functions/forge-data?type=pie_predictions&token='+encodeURIComponent(localStorage.getItem('forge_token')||localStorage.getItem('wingman_sub_token')||''))")
        html = html.replace("fetch('pie_brief.json')", "fetch('/.netlify/functions/forge-data?type=pie_brief&token='+encodeURIComponent(localStorage.getItem('forge_token')||''))")
        html = html.replace("fetch('pie_weekly.json')", "fetch('/.netlify/functions/forge-data?type=pie_weekly&token='+encodeURIComponent(localStorage.getItem('forge_token')||localStorage.getItem('wingman_sub_token')||''))")
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

    Pro paths (/patterns/, /pro/) route to uas-patterns.pro.
    All other Forge paths route to uas-forge.com.
    All other Patterns paths route to uas-patterns.com.
    Handbook references route to uas-handbook.com.

    Order matters: specific-path rules must run before bare-domain rules
    so e.g. nvmillbuilditmyself.com/pro/ → uas-patterns.pro/pro/ wins
    over the generic nvmillbuilditmyself.com → uas-forge.com.
    """
    # Pro-specific paths (must come first — more specific than bare domain)
    specific = [
        ('https://nvmillbuilditmyself.com/patterns/', 'https://uas-patterns.pro/patterns/'),
        ('https://nvmillbuilditmyself.com/pro/',      'https://uas-patterns.pro/pro/'),
        ('https://nvmillfindoutmyself.com/patterns/', 'https://uas-patterns.pro/patterns/'),
        ('https://nvmillfindoutmyself.com/pro/',      'https://uas-patterns.pro/pro/'),
    ]
    for old, new in specific:
        html = html.replace(old, new)

    # Bare-domain replacements (catch-all for everything else)
    bare = [
        ('https://www.nvmillbuilditmyself.com', 'https://uas-forge.com'),
        ('https://nvmillbuilditmyself.com',     'https://uas-forge.com'),
        ('https://www.nvmillfindoutmyself.com', 'https://uas-patterns.com'),
        ('https://nvmillfindoutmyself.com',     'https://uas-patterns.com'),
        ('https://www.nvmilldoitmyself.com',    'https://uas-handbook.com'),
        ('https://nvmilldoitmyself.com',        'https://uas-handbook.com'),
        ('https://www.illdoitmyself.com',       'https://uas-handbook.com'),
        ('https://illdoitmyself.com',           'https://uas-handbook.com'),
    ]
    for old, new in bare:
        html = html.replace(old, new)

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
    'pro.html': (
        'Forge Pro — Full Access to PIE Intelligence & Analytics',
        'Upgrade to Forge Pro for full PIE flag access, daily intelligence briefs, gray zone entity tracking, procurement signal analysis, and Document Builder templates.',
        'Forge Pro, drone intelligence subscription, PIE flags, UAS procurement intelligence, drone compliance subscription',
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
    'vault.html': (
        'Forge Vault — Combat & Gray-Area UAS Components',
        'Restricted access database of 580+ combat, tactical, and gray-area drone components including MAFIA FPV, Ukrainian wartime hardware, and loitering munition subsystems.',
        'combat drone parts, FPV wartime components, MAFIA drone, Ukrainian FPV, loitering munition components',
    ),
    'intel-defense.html': (
        'Defense Intel Feed — DoD UAS Contracts & Programs',
        'Defense-focused drone intelligence: DoD contract awards, program updates, NDAA procurement signals, Blue UAS adoption, and military UAS developments.',
        'DoD drone contracts, military UAS intelligence, drone defense procurement, NDAA programs, Blue UAS contracts',
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
    'intel-financial.html': (
        'Financial Intel Feed — Drone Industry Funding & M&A',
        'Drone industry financial intelligence: funding rounds, valuations, M&A deals, SPAC activity, earnings signals, and investor activity across the UAS sector.',
        'drone funding rounds, UAS investment, drone M&A, FPV industry finance, drone startup funding',
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
    'privacy.html': (
        'Privacy Policy — Forge Drone Intelligence Platform',
        'Forge privacy policy. No cookies, no PII collection, no tracking. Analytics are anonymized session data only.',
        'Forge privacy policy, drone platform privacy, no tracking, anonymous analytics',
    ),
    'terms.html': (
        'Terms of Service — Forge Drone Intelligence Platform',
        'Terms of service for the Forge drone intelligence platform, including data usage, subscription terms, and acceptable use policy.',
        'Forge terms of service, drone platform terms, subscription terms',
    ),
    'admin.html': (
        'Forge Admin — Internal Dashboard',
        'Internal Forge administration dashboard.',
        'Forge admin',
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
    # Patterns pages live on uas-patterns.com (free) / uas-patterns.pro (gated).
    # Main Forge tooling lives on uas-forge.com. Legacy nvmill* domains
    # 301 → new ones during the transition window (see netlify.toml).
    CANONICAL_OVERRIDES = {
        # Patterns Pro (gated / paid) — uas-patterns.pro
        'patterns/':       'https://uas-patterns.pro/patterns/',
        # Patterns free / public — uas-patterns.com
        'patterns-home/':  'https://uas-patterns.com/patterns-home/',
        'clock/':          'https://uas-patterns.com/clock/',
        'ddg/':            'https://uas-patterns.com/ddg/',
        'brief/':          'https://uas-patterns.com/brief/',
        'analytics/':      'https://uas-patterns.com/analytics/',
        # Main Forge — uas-forge.com
        'browse/':             'https://uas-forge.com/browse/',
        'builder/':            'https://uas-forge.com/builder/',
        'compare/':            'https://uas-forge.com/compare/',
        'compliance/':         'https://uas-forge.com/compliance/',
        'compliance-matrix/':  'https://uas-forge.com/compliance-matrix/',
        'cost/':               'https://uas-forge.com/cost/',
        'payload-compare/':    'https://uas-forge.com/payload-compare/',
        'platforms/':          'https://uas-forge.com/platforms/',
        'stack-builder/':      'https://uas-forge.com/stack-builder/',
        'spec-sheets/':        'https://uas-forge.com/spec-sheets/',
        'intel/':              'https://uas-forge.com/intel/',
        'intel/feed/':         'https://uas-forge.com/intel/feed/',
        'intel-defense/':      'https://uas-forge.com/intel-defense/',
        'intel-commercial/':   'https://uas-forge.com/intel-commercial/',
        'intel-dfr/':          'https://uas-forge.com/intel-dfr/',
        'intel-financial/':    'https://uas-forge.com/intel-financial/',
        'timeline/':           'https://uas-forge.com/timeline/',
        'industry/':           'https://uas-forge.com/industry/',
        'tracker/':            'https://uas-forge.com/tracker/',
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
        'pro/':                'https://uas-patterns.pro/pro/',
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



def build():
    # Step 0: Sync data from handbook repo
    sync_handbook_data()

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
        shutil.copy2(src, dst)
        copied += 1

    print(f"  Copied {copied} static assets, skipped {skipped} gated files")

    # Explicitly copy full intel files to build root (served at /pie_flags.json etc.)
    # These are NOT in /static/ — they live at root so authed users get full data
    ROOT_INTEL_FILES = ['pie_flags.json', 'pie_predictions.json', 'predictions_best.json',
                        'pie_brief.json', 'pie_trends.json', 'solicitations.json',
                        'intel_articles.json', 'intel_companies.json', 'intel_platforms.json',
                        'intel_programs.json']
    for fname in ROOT_INTEL_FILES:
        src = os.path.join(SRC_DIR, fname)
        dst = os.path.join(BUILD_DIR, fname)
        if os.path.exists(src):
            shutil.copy2(src, dst)
    print(f"  Copied {len(ROOT_INTEL_FILES)} intel files to build root")

    # Master DB files are gated — served by forge-data.mjs, not in public build
    # defense_master, commercial_master, dfr_master Ã¢ÂÂ never in build/static/
    
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
        html = fix_paths(html, depth)
        html = inject_seo(html, src_name, dst_path)
        html = inject_adapter(html, depth)
        html = inject_analytics(html, src_name)
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
    
    # netlify.toml lives in the repo root — do not overwrite it from the build script.
    # All redirect rules are maintained in the root netlify.toml.
    
    # Summary
    total_files = sum(1 for _, _, files in os.walk(BUILD_DIR) for _ in files)
    total_size = sum(os.path.getsize(os.path.join(dp, f)) 
                     for dp, _, files in os.walk(BUILD_DIR) for f in files)
    
    print(f"\n{'Ã¢ÂÂ' * 50}")
    print(f"  Forge static build complete")
    print(f"  {total_files} files, {total_size / 1024 / 1024:.1f} MB")
    print(f"  Ready for: netlify deploy --dir=build")
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


if __name__ == '__main__':
    build()
