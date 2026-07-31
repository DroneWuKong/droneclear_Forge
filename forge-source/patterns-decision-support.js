/*
 * Decision-support framing for Patterns flags.
 *
 * The module turns an existing indexed signal into a structured review aid:
 * why it may matter, what to verify next, and which Forge records may help.
 * It does not determine compliance, legal status, attribution, security, or a
 * purchase decision. All functions are pure and available to browser and Node
 * software-only tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PatternsDecisionSupport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COMPANY_SUFFIXES = new Set([
    'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'llc',
    'ltd', 'limited', 'plc', 'gmbh', 'holdings', 'holding', 'group',
    'technologies', 'technology', 'systems', 'solutions', 'international'
  ]);

  const KIND_PATTERNS = [
    ['legal_regulatory', /\b(legal|lawsuit|court|docket|injunction|regulatory|regulation|fcc|faa|covered list|sanction|export control|itar|ear|ndaa|section 848|compliance)\b/],
    ['cyber_security', /\b(cyber|security|vulnerability|exploit|firmware|malware|backdoor|data exfiltration|cve|penetration)\b/],
    ['supply_chain', /\b(supply|component|part|shortage|inventory|lead time|obsolete|obsolescence|end of life|eol|manufacturer|diversion|dependency|substitute)\b/],
    ['procurement', /\b(procurement|solicitation|contract|award|funding|budget|program|rfp|rfi|idiq|sbir|ota|purchase)\b/],
    ['corporate', /\b(acquisition|acquired|ownership|parent|subsidiary|investment|funding round|bankruptcy|merger|m&a|leadership)\b/],
    ['operational', /\b(operational|doctrine|ttp|counter-uas|cuas|electronic warfare|jamming|spoofing|autonomy|swarm|strike|reconnaissance|isr)\b/]
  ];

  function normalize(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function slugify(value) {
    const parts = normalize(value).split(' ').filter(Boolean);
    while (parts.length > 1 && COMPANY_SUFFIXES.has(parts[parts.length - 1])) parts.pop();
    return parts.join('-');
  }

  function textOf(flag) {
    const row = flag || {};
    return normalize([
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
    ].filter(Boolean).join(' '));
  }

  function kinds(flag) {
    const text = textOf(flag);
    const matched = KIND_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
    return matched.length ? matched : ['general'];
  }

  function sourceStats(flag) {
    const sources = Array.isArray(flag && flag.sources) ? flag.sources : [];
    const unique = new Set();
    const typeCounts = {};
    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      const key = normalize(source.url || source.id || source.name);
      if (key) unique.add(key);
      const type = normalize(source.type || 'unknown').replace(/ /g, '_') || 'unknown';
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    return {
      reference_count: sources.length,
      unique_source_count: unique.size,
      primary_reference_count: typeCounts.primary || 0,
      type_counts: typeCounts
    };
  }

  function severity(flag) {
    const value = normalize(flag && flag.severity).split(' ')[0];
    return value || 'unknown';
  }

  function scope(flag) {
    const row = flag || {};
    return {
      entity: String(row.entity || row.manufacturer || row.vendor || '').trim(),
      platform_id: String(row.platform_id || '').trim(),
      component_id: String(row.component_id || '').trim(),
      flag_type: String(row.flag_type || row.category || '').trim()
    };
  }

  function whyItMatters(flag) {
    const row = flag || {};
    const sev = severity(row);
    const matchedKinds = kinds(row);
    const points = [];

    if (['critical', 'high'].includes(sev)) {
      points.push('This is a high-priority indexed signal. Verify it before relying on the current vendor, component, platform, or program status.');
    } else if (['warning', 'medium'].includes(sev)) {
      points.push('This signal may affect near-term planning if corroborated; it is not a final determination.');
    } else {
      points.push('This signal provides context for monitoring and does not by itself imply an immediate action.');
    }

    if (matchedKinds.includes('legal_regulatory')) {
      points.push('The authoritative legal, regulatory, authorization, or eligibility record may have changed after the indexed report.');
    }
    if (matchedKinds.includes('supply_chain')) {
      points.push('The issue may affect availability, lead time, substitution, component origin, or dependency assumptions.');
    }
    if (matchedKinds.includes('cyber_security')) {
      points.push('Technical scope and affected versions must be confirmed before applying a security conclusion to other products or deployments.');
    }
    if (matchedKinds.includes('procurement')) {
      points.push('Deadlines, eligibility, funding, and award status should be checked against the official procurement record.');
    }
    if (matchedKinds.includes('corporate')) {
      points.push('Ownership, parent relationships, leadership, or lifecycle status may change how current vendor records should be interpreted.');
    }
    if (matchedKinds.includes('operational')) {
      points.push('Public reporting can support research prioritization but does not establish event-level attribution or capability by itself.');
    }

    return Array.from(new Set(points)).slice(0, 4);
  }

  function verifyNext(flag) {
    const row = flag || {};
    const matchedKinds = kinds(row);
    const stats = sourceStats(row);
    const steps = [];

    if (stats.primary_reference_count) {
      steps.push('Open the linked primary evidence and confirm that it supports the exact claim and affected record.');
    } else {
      steps.push('Locate an authoritative or first-party record before treating this signal as confirmed.');
    }

    steps.push('Check the signal date, current status, scope, and whether later evidence confirms, narrows, contradicts, or resolves it.');

    if (matchedKinds.includes('legal_regulatory')) {
      steps.push('Verify the current docket, agency notice, covered-list entry, rule, waiver, authorization, or official compliance guidance.');
    }
    if (matchedKinds.includes('supply_chain')) {
      steps.push('Identify affected part numbers and platforms, then check inventory, lead times, country-of-origin evidence, and qualified substitutes.');
    }
    if (matchedKinds.includes('cyber_security')) {
      steps.push('Confirm affected hardware, firmware, versions, prerequisites, exploitability, and available mitigations or compensating controls.');
    }
    if (matchedKinds.includes('procurement')) {
      steps.push('Check the authoritative solicitation or award for current dates, amendments, eligibility, funding, and point-of-contact information.');
    }
    if (matchedKinds.includes('corporate')) {
      steps.push('Confirm current ownership, subsidiaries, operating status, and the effective date of the corporate change.');
    }
    if (matchedKinds.includes('operational')) {
      steps.push('Separate article mentions from distinct events and review corroboration, imagery, location, and attribution confidence.');
    }

    return Array.from(new Set(steps)).slice(0, 5);
  }

  function affectedLinks(flag) {
    const row = flag || {};
    const matchedKinds = kinds(row);
    const links = [];
    const entity = String(row.entity || row.manufacturer || row.vendor || '').trim();
    const entitySlug = entity && normalize(entity) !== 'all' ? slugify(entity) : '';

    if (entitySlug) {
      links.push({
        id: 'manufacturer_dossier',
        label: 'Forge manufacturer dossier',
        url: `https://uas-forge.com/dossier/?m=${encodeURIComponent(entitySlug)}`,
        reason: 'Review current vendor status, corporate family, parts, spec sheets, alternatives, and matched Patterns signals.'
      });
    }

    if (row.component_id || matchedKinds.includes('supply_chain')) {
      links.push({
        id: 'components',
        label: 'Forge component catalog',
        url: 'https://uas-forge.com/browse/?view=components',
        reason: row.component_id
          ? `Review the affected component record (${String(row.component_id)}), compatible alternatives, and related platforms.`
          : 'Review affected component categories, origin evidence, availability, and substitutes.'
      });
      links.push({
        id: 'compare',
        label: 'Forge comparison tool',
        url: 'https://uas-forge.com/compare/',
        reason: 'Compare candidate replacements without treating the signal as an automatic disqualification.'
      });
    }

    if (row.platform_id || matchedKinds.includes('operational')) {
      links.push({
        id: 'platforms',
        label: 'Forge platform catalog',
        url: 'https://uas-forge.com/platforms/',
        reason: row.platform_id
          ? `Review the affected platform record (${String(row.platform_id)}) and its documented dependencies.`
          : 'Review documented platform records and dependencies related to this operational signal.'
      });
    }

    if (matchedKinds.includes('legal_regulatory')) {
      links.push({
        id: 'compliance',
        label: 'Forge compliance workspace',
        url: 'https://uas-forge.com/compliance/',
        reason: 'Reconcile the signal with current product, vendor, and program compliance evidence.'
      });
      links.push({
        id: 'regulations',
        label: 'Forge regulations index',
        url: 'https://uas-forge.com/regs/',
        reason: 'Review the applicable regulatory source and effective dates.'
      });
    }

    if (matchedKinds.includes('procurement')) {
      links.push({
        id: 'tracker',
        label: 'Forge contract tracker',
        url: 'https://uas-forge.com/tracker/',
        reason: 'Check current procurement status, dates, amendments, and award context.'
      });
    }

    if (matchedKinds.includes('corporate')) {
      links.push({
        id: 'entity_graph',
        label: 'Forge entity graph',
        url: 'https://uas-forge.com/entity-graph/',
        reason: 'Review documented parent, subsidiary, investment, and program relationships.'
      });
    }

    const seen = new Set();
    return links.filter(link => {
      if (seen.has(link.id)) return false;
      seen.add(link.id);
      return true;
    });
  }

  function limitations(flag) {
    const row = flag || {};
    const notes = [
      'This is an indexed analytic signal, not a legal finding, compliance determination, security verdict, attribution, or purchase recommendation.'
    ];
    const entity = normalize(row.entity);
    if (!entity || entity === 'all') {
      notes.push('The signal is not scoped to one verified entity; affected-record links are therefore category-level unless another identifier is present.');
    }
    if (!sourceStats(row).primary_reference_count) {
      notes.push('No source marked primary is attached to this record; treat it as a lead until authoritative evidence is added.');
    }
    notes.push('Absence of a matched record or keyword is not evidence that no risk, funding, capability, restriction, or alternative exists.');
    return notes;
  }

  function build(flag) {
    const row = flag || {};
    return {
      severity: severity(row),
      kinds: kinds(row),
      scope: scope(row),
      source_stats: sourceStats(row),
      why_it_matters: whyItMatters(row),
      verify_next: verifyNext(row),
      affected_links: affectedLinks(row),
      limitations: limitations(row)
    };
  }

  return {
    normalize,
    slugify,
    textOf,
    kinds,
    sourceStats,
    severity,
    scope,
    whyItMatters,
    verifyNext,
    affectedLinks,
    limitations,
    build
  };
});
