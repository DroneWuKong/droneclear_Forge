/*
 * Forge manufacturer dossier ↔ Patterns signal join.
 *
 * Pure data functions are exported for Node-based software tests and attached
 * to window/globalThis for the static dossier page. Matching is deliberately
 * conservative: an `entity: all` flag only matches when the vendor is named in
 * the flag text, and a match remains an indexed public-source signal rather
 * than a finding, allegation, or compliance determination.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForgeDossierSignals = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMPANY_SUFFIXES = new Set([
    'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'llc',
    'ltd', 'limited', 'plc', 'gmbh', 'holdings', 'holding', 'group',
    'technologies', 'technology', 'systems', 'solutions', 'international'
  ]);

  const SEVERITY_ORDER = {
    critical: 0,
    high: 1,
    warning: 2,
    medium: 3,
    watch: 4,
    low: 5,
    info: 6,
    informational: 6,
    unknown: 7
  };

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function stripSuffixes(value) {
    const parts = normalize(value).split(' ').filter(Boolean);
    while (parts.length > 1 && COMPANY_SUFFIXES.has(parts[parts.length - 1])) {
      parts.pop();
    }
    return parts.join(' ');
  }

  function addAlias(target, value) {
    const normalized = normalize(value);
    if (normalized.length >= 3) target.add(normalized);
    const stripped = stripSuffixes(value);
    if (stripped.length >= 3) target.add(stripped);
  }

  function entityAliases(slug, record) {
    const aliases = new Set();
    addAlias(aliases, String(slug || '').replace(/-/g, ' '));
    const rec = record || {};
    addAlias(aliases, rec.name);
    addAlias(aliases, String(rec.name || '').split('(')[0]);
    addAlias(aliases, rec.ticker);
    for (const value of rec.aliases || []) addAlias(aliases, value);
    for (const value of rec.former_names || []) addAlias(aliases, value);
    return Array.from(aliases).sort((a, b) => b.length - a.length);
  }

  function unwrapApi(value) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
      return value.data;
    }
    return value;
  }

  function flagText(flag) {
    const row = flag || {};
    const values = [
      row.title,
      row.detail,
      row.summary,
      row.description,
      row.category,
      row.flag_type,
      row.entity,
      row.manufacturer,
      row.vendor,
      row.platform_id,
      row.component_id,
      row.prediction
    ];
    return normalize(values.filter(Boolean).join(' '));
  }

  function containsAlias(haystack, alias) {
    if (!haystack || !alias) return false;
    return (` ${haystack} `).includes(` ${alias} `);
  }

  function partIds(parts) {
    const ids = new Set();
    for (const part of parts || []) {
      for (const value of [part && part.pid, part && part.id, part && part.component_id]) {
        const normalized = normalize(value);
        if (normalized) ids.add(normalized);
      }
    }
    return ids;
  }

  function matchFlag(flag, slug, record, parts) {
    if (!flag || typeof flag !== 'object') return null;
    const status = normalize(flag.status || 'active');
    if (status && !['active', 'open', 'current', 'monitoring', 'watch'].includes(status)) return null;

    const aliases = entityAliases(slug, record);
    const canonicalSlug = normalize(String(slug || '').replace(/-/g, ' '));
    const entity = normalize(flag.entity);
    const manufacturer = normalize(flag.manufacturer || flag.vendor);
    const text = flagText(flag);
    const reasons = [];

    if (entity && entity !== 'all' && (entity === canonicalSlug || aliases.includes(entity))) {
      reasons.push('entity');
    }
    if (manufacturer && aliases.some(alias => manufacturer === alias || containsAlias(manufacturer, alias))) {
      reasons.push('manufacturer');
    }

    const component = normalize(flag.component_id);
    if (component && partIds(parts).has(component)) reasons.push('component');

    // Global flags and unmatched entity records require an explicit vendor name
    // in the title/detail corpus. This prevents every `entity: all` record from
    // appearing on every dossier.
    if (aliases.some(alias => containsAlias(text, alias))) reasons.push('text');

    if (!reasons.length) return null;
    return Object.assign({}, flag, {
      _match_reasons: Array.from(new Set(reasons)),
      _match_confidence: reasons.includes('entity') || reasons.includes('manufacturer') || reasons.includes('component')
        ? 'direct'
        : 'contextual'
    });
  }

  function signalDate(flag) {
    const value = flag && (flag.last_seen || flag.timestamp || flag.date || flag.first_seen);
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function severityRank(value) {
    const key = normalize(value || 'unknown').split(' ')[0] || 'unknown';
    return Object.prototype.hasOwnProperty.call(SEVERITY_ORDER, key)
      ? SEVERITY_ORDER[key]
      : SEVERITY_ORDER.unknown;
  }

  function sortSignals(rows) {
    return Array.from(rows || []).sort((a, b) => {
      const severityDelta = severityRank(a.severity) - severityRank(b.severity);
      if (severityDelta) return severityDelta;
      const dateDelta = signalDate(b) - signalDate(a);
      if (dateDelta) return dateDelta;
      return String(a.title || a.id || '').localeCompare(String(b.title || b.id || ''));
    });
  }

  function matchFlags(flags, slug, record, parts) {
    const rows = Array.isArray(flags) ? flags : [];
    return sortSignals(rows.map(flag => matchFlag(flag, slug, record, parts)).filter(Boolean));
  }

  function sourceKey(source) {
    if (!source || typeof source !== 'object') return '';
    return normalize(source.url || source.id || source.name);
  }

  function summarize(signals) {
    const rows = Array.isArray(signals) ? signals : [];
    const severities = {};
    const sourceKeys = new Set();
    let primarySourceCount = 0;
    let latest = 0;
    for (const row of rows) {
      const severity = normalize(row.severity || 'unknown').split(' ')[0] || 'unknown';
      severities[severity] = (severities[severity] || 0) + 1;
      latest = Math.max(latest, signalDate(row));
      for (const source of row.sources || []) {
        const key = sourceKey(source);
        if (key) sourceKeys.add(key);
        if (normalize(source && source.type) === 'primary') primarySourceCount += 1;
      }
    }
    return {
      count: rows.length,
      severity_counts: severities,
      unique_source_count: sourceKeys.size,
      primary_source_reference_count: primarySourceCount,
      latest_at: latest ? new Date(latest).toISOString() : null,
      direct_match_count: rows.filter(row => row._match_confidence === 'direct').length,
      contextual_match_count: rows.filter(row => row._match_confidence === 'contextual').length
    };
  }

  function reviewPrompts(signals) {
    const rows = Array.isArray(signals) ? signals : [];
    if (!rows.length) return [];
    const corpus = normalize(rows.map(flagText).join(' '));
    const prompts = [
      'Open the linked evidence before using an indexed signal in a purchasing, compliance, or operational decision.'
    ];
    if (/regulatory|legal|lawsuit|fcc|ndaa|compliance|covered list|sanction/.test(corpus)) {
      prompts.push('Re-verify the current legal, authorization, and procurement status against the authoritative record.');
    }
    if (/supply|component|shortage|export|inventory|lead time|obsolescence|end of life/.test(corpus)) {
      prompts.push('Check affected parts, inventory exposure, lead times, and qualified substitutes in Forge.');
    }
    if (/acquisition|ownership|parent|subsidiary|funding|investment|bankruptcy/.test(corpus)) {
      prompts.push('Confirm current ownership and corporate status before relying on historical vendor relationships.');
    }
    if (/cyber|vulnerability|exploit|security|firmware|data exfiltration/.test(corpus)) {
      prompts.push('Review the technical evidence and identify compensating controls before drawing a security conclusion.');
    }
    const summary = summarize(rows);
    if (!summary.primary_source_reference_count) {
      prompts.push('Treat this as a research lead until it is corroborated by a primary source.');
    }
    return Array.from(new Set(prompts)).slice(0, 4);
  }

  return {
    normalize,
    stripSuffixes,
    entityAliases,
    unwrapApi,
    flagText,
    matchFlag,
    matchFlags,
    sortSignals,
    severityRank,
    summarize,
    reviewPrompts
  };
});
