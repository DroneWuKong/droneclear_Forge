/* dash-brief.js — "At a glance" generated brief for the dash.uas-forge.com intel surfaces.
 *
 * Hybrid model (per product decision):
 *   • Computed summary  — ALWAYS rendered, derived deterministically from the surface's
 *                         own data (counts, deltas/trends, plain-language orientation).
 *   • Analyst narrative — layered on ONLY when the data already carries one
 *                         (clock_score.narrative, pie_brief.headline, or a future
 *                         per-surface `llm_summary`/`analyst_note` field the pipeline
 *                         can populate without any frontend change).
 *
 * Surfaces (keyed off window.__FORGE_PAGE__): tracker, patterns, patterns-home, clock.
 *
 * Defensive by construction: never throws, and no-ops if the surface is unknown, the
 * data is missing, or no mount point is found — so it can never break the page it rides.
 */
(function () {
  'use strict';

  // Key off the URL path (reliable) — NOT __FORGE_PAGE__, which build_static.py
  // overloads for analytics grouping (e.g. tracker.html → "patterns").
  var SURFACE = (function () {
    var seg = (location.pathname || '').toLowerCase().replace(/\/+$/, '').split('/').pop();
    return ['tracker', 'patterns', 'patterns-home', 'clock'].indexOf(seg) !== -1 ? seg : '';
  })();
  if (!SURFACE) return;

  // ── small helpers ──────────────────────────────────────────────────────────
  function num(n) { return (typeof n === 'number' && isFinite(n)) ? n.toLocaleString() : '—'; }
  function titleCase(k) { return String(k).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }

  // Try each URL in order; resolve with the first JSON that parses, else null.
  function getJSON(urls) {
    return urls.reduce(function (p, u) {
      return p.then(function (r) {
        if (r) return r;
        return fetch(u).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; });
      });
    }, Promise.resolve(null));
  }

  // Map a threat / severity word to a tone class.
  function tone(word) {
    var t = String(word || '').toUpperCase();
    if (/CRIT|SEVERE|HIGH|RED/.test(t)) return 'bad';
    if (/GUARD|ELEV|WARN|AMBER|MODERATE/.test(t)) return 'warn';
    if (/LOW|STABLE|NORMAL|GREEN|NOMINAL/.test(t)) return 'ok';
    return '';
  }

  // Pull a narrative the pipeline already produced, if any (the "LLM layer").
  function narrativeOf(d) {
    if (!d) return null;
    return d.llm_summary || d.analyst_note || d.narrative ||
           d.headline || (d.lead_story && (d.lead_story.summary || d.lead_story.headline)) || null;
  }

  // ── per-surface builders → {oneLiner, stats:[{label,value,tone}], changed:[str], narrative} ──
  var BUILDERS = {
    clock: function () {
      return getJSON(['/api/data?type=clock_score', '/static/clock_score.json']).then(function (d) {
        if (!d) return null;
        var f = d.factors || {}, changed = [];
        Object.keys(f).forEach(function (k) {
          var tr = f[k] && f[k].trend;
          if (tr && tr !== 'stable') changed.push(titleCase(k) + (tr === 'up' ? ' ↑ rising' : tr === 'down' ? ' ↓ easing' : ' ' + tr));
        });
        return {
          oneLiner: 'The UAS Ecosystem Risk Index (UERI) — a composite "doomsday clock" for the drone ecosystem. Fewer minutes-to-midnight means higher system-wide stress.',
          stats: [
            { label: 'Clock', value: d.display || '—', tone: tone(d.threat_level) },
            { label: 'Threat level', value: d.threat_level || '—', tone: tone(d.threat_level) },
            { label: 'UERI', value: num(d.ueri_score) + (d.ueri_max_active ? ' / ' + num(d.ueri_max_active) : '') },
            { label: 'Active factors', value: num(d.active_factors) }
          ],
          changed: changed.length ? changed.slice(0, 4) : ['All factors stable since the last reading.'],
          narrative: narrativeOf(d)
        };
      });
    },

    patterns: function () {
      return getJSON(['/api/data?type=pie_brief', '/static/pie_brief.json']).then(function (d) {
        if (!d) return null;
        var s = d.signal_summary || {}, dl = d.delta_summary || {};
        var changed = [dl.vs_yesterday || (num(s.new_today) + ' new today')];
        if (dl.new_flag_titles && dl.new_flag_titles.length) changed.push('New: ' + dl.new_flag_titles.slice(0, 2).join('; '));
        return {
          oneLiner: 'Active PIE flags — public-source risk indicators across regulatory, gray-zone, and supply-chain signals. Severity is an analytic signal, not an allegation of wrongdoing.',
          stats: [
            { label: 'Total flags', value: num(s.total_flags) },
            { label: 'Critical', value: num(s.critical), tone: 'bad' },
            { label: 'Warning', value: num(s.warning), tone: 'warn' },
            { label: 'FCC days left', value: num(s.fcc_days_remaining) }
          ],
          changed: changed,
          narrative: narrativeOf(d)
        };
      });
    },

    'patterns-home': function () {
      return Promise.all([
        getJSON(['/api/data?type=pie_brief', '/static/pie_brief.json']),
        getJSON(['/api/data?type=clock_score', '/static/clock_score.json'])
      ]).then(function (r) {
        var pb = r[0], ck = r[1];
        if (!pb && !ck) return null;
        var s = (pb && pb.signal_summary) || {};
        return {
          oneLiner: 'Patterns / PIE — the public-source intelligence surface: the risk clock, active flags, predictions, and gray-zone tracking, refreshed by the daily pipeline.',
          stats: [
            { label: 'Risk clock', value: (ck && ck.display) || '—', tone: tone(ck && ck.threat_level) },
            { label: 'Active flags', value: num(s.total_flags) },
            { label: 'Critical', value: num(s.critical), tone: 'bad' },
            { label: 'New today', value: num(s.new_today) }
          ],
          changed: [(pb && pb.delta_summary && pb.delta_summary.vs_yesterday) || 'See the daily brief for what moved.'],
          narrative: narrativeOf(pb) || narrativeOf(ck)
        };
      });
    },

    tracker: function () {
      // Personal cert & currency dashboard — items live in localStorage; computed-only.
      var items = readTrackerItems();
      var now = Date.now(), D30 = 30 * 864e5, cur = 0, soon = 0, exp = 0;
      items.forEach(function (it) {
        var raw = it && (it.expiry || it.expires || it.expiration || it.due || it.date);
        var t = raw ? Date.parse(raw) : NaN;
        if (isNaN(t)) { cur++; return; }
        if (t < now) exp++; else if (t - now < D30) soon++; else cur++;
      });
      var changed = items.length
        ? [soon ? (soon + ' item(s) need renewal within 30 days.')
                : (exp ? (exp + ' item(s) already expired — update or remove them.')
                       : 'Everything current — nothing due in the next 30 days.')]
        : ['No items tracked yet — add a cert/rating to populate this brief.'];
      return Promise.resolve({
        oneLiner: 'Your personal cert & currency tracker — certificates, ratings, and recurring requirements you have logged (kept in this browser only).',
        stats: [
          { label: 'Tracked', value: num(items.length) },
          { label: 'Current', value: num(cur), tone: 'ok' },
          { label: 'Expiring ≤30d', value: num(soon), tone: soon ? 'warn' : '' },
          { label: 'Expired', value: num(exp), tone: exp ? 'bad' : '' }
        ],
        changed: changed,
        narrative: null
      });
    }
  };

  function readTrackerItems() {
    var keys = ['cert_tracker', 'certs', 'currency_items', 'tracker_items', 'forge_cert_tracker'];
    for (var i = 0; i < keys.length; i++) {
      try {
        var raw = localStorage.getItem(keys[i]);
        if (!raw) continue;
        var v = JSON.parse(raw);
        if (Array.isArray(v)) return v;
        if (v && Array.isArray(v.items)) return v.items;
      } catch (e) { /* ignore malformed */ }
    }
    return [];
  }

  // ── render ───────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('dash-brief-css')) return;
    var css = document.createElement('style');
    css.id = 'dash-brief-css';
    css.textContent = [
      '.dash-brief{background:var(--card,#15150f);border:1px solid var(--border,#2a2a22);border-left:3px solid var(--cyan,#22d3ee);border-radius:10px;padding:14px 16px;margin:0 0 20px;font-family:var(--font,system-ui,sans-serif)}',
      '.dash-brief__hd{display:flex;align-items:center;gap:8px;font:700 11px var(--font,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--cyan,#22d3ee);margin-bottom:6px}',
      '.dash-brief__hd .t{margin-left:auto;font-weight:500;letter-spacing:0;text-transform:none;color:var(--text-d,#7a7a6a);font-size:10px}',
      '.dash-brief__one{font-size:12.5px;line-height:1.5;color:var(--text-s,#b8b8a8);margin:0 0 10px}',
      '.dash-brief__stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}',
      '.dash-brief__chip{background:var(--bg,#0c0c0a);border:1px solid var(--border,#2a2a22);border-radius:7px;padding:6px 10px;min-width:64px}',
      '.dash-brief__chip .v{font:800 16px var(--mono,ui-monospace,monospace);color:var(--text,#e8e8d8)}',
      '.dash-brief__chip .v.ok{color:var(--green,#16a34a)}.dash-brief__chip .v.warn{color:var(--amber,#f59e0b)}.dash-brief__chip .v.bad{color:var(--red,#dc2626)}',
      '.dash-brief__chip .l{font:500 10px var(--font,system-ui);color:var(--text-d,#7a7a6a);margin-top:1px}',
      '.dash-brief__chg{font-size:11.5px;color:var(--text-s,#b8b8a8);margin:0 0 4px}.dash-brief__chg b{color:var(--text,#e8e8d8);font-weight:600}',
      '.dash-brief__chg .lbl{color:var(--cyan,#22d3ee);font-weight:700;margin-right:5px}',
      '.dash-brief__narr{font-size:12px;line-height:1.55;color:var(--text-s,#b8b8a8);border-top:1px solid var(--border,#2a2a22);margin-top:10px;padding-top:9px}',
      '.dash-brief__narr .lbl{display:block;font:700 9.5px var(--font,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--text-d,#7a7a6a);margin-bottom:3px}'
    ].join('');
    document.head.appendChild(css);
  }

  function findMount() {
    var sels = ['main', '.wrap', '.container', '.content', '#app', '#main', 'body'];
    for (var i = 0; i < sels.length; i++) { var el = document.querySelector(sels[i]); if (el) return el; }
    return document.body;
  }

  function render(b) {
    if (!b) return;
    injectStyles();
    var card = document.createElement('section');
    card.className = 'dash-brief';
    card.id = 'dash-brief';

    var stats = (b.stats || []).map(function (s) {
      return '<div class="dash-brief__chip"><div class="v ' + (s.tone || '') + '">' +
        esc(s.value) + '</div><div class="l">' + esc(s.label) + '</div></div>';
    }).join('');

    var changed = (b.changed || []).map(function (c) {
      return '<div class="dash-brief__chg"><span class="lbl">Δ</span>' + esc(c) + '</div>';
    }).join('');

    var narr = b.narrative
      ? '<div class="dash-brief__narr"><span class="lbl">Analyst summary</span>' + esc(b.narrative) + '</div>'
      : '';

    card.innerHTML =
      '<div class="dash-brief__hd"><i class="ph ph-newspaper-clipping"></i>Brief' +
        '<span class="t">auto-generated · ' + new Date().toLocaleString() + '</span></div>' +
      '<p class="dash-brief__one">' + esc(b.oneLiner) + '</p>' +
      (stats ? '<div class="dash-brief__stats">' + stats + '</div>' : '') +
      changed + narr;

    var host = findMount();
    var h1 = host.querySelector('h1');
    if (h1 && h1.parentNode) h1.parentNode.insertBefore(card, h1.nextSibling);
    else host.insertBefore(card, host.firstChild);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function init() {
    if (document.getElementById('dash-brief')) return; // guard double-inject
    try {
      var b = BUILDERS[SURFACE];
      if (!b) return;
      Promise.resolve(b()).then(render).catch(function () { /* silent: never break the page */ });
    } catch (e) { /* silent */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed for build-time unit tests (no effect in the browser).
  window.__dashBrief = { BUILDERS: BUILDERS, tone: tone, narrativeOf: narrativeOf, _readTrackerItems: readTrackerItems };
})();
