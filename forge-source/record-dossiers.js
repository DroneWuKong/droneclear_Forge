/*
 * Forge component and platform dossiers.
 *
 * Pure record-resolution and relationship functions are exported for Node
 * tests. In the browser, the module activates on the existing /dossier/ route
 * when either ?component=<stable-id> or ?platform=<stable-id> is present.
 *
 * Relationship and alternative logic is deliberately conservative. Explicit
 * identifiers and structured relationship fields are preferred; descriptions
 * are not treated as proof that a component is installed on a platform or that
 * two records are drop-in replacements.
 */
(function (root, factory) {
  const api = factory(root.ForgeDossierSignals || null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ForgeRecordDossiers = api;
  if (typeof document !== 'undefined' && typeof location !== 'undefined') {
    api.bootstrapFromLocation().catch(function (error) {
      console.error('[Forge record dossier]', error);
      const main = document.querySelector('main');
      if (main) {
        main.innerHTML = '<div class="frd-empty">Unable to load this record dossier. The requested record may be missing or the public data files may be unavailable.</div>';
      }
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (signalsApi) {
  'use strict';

  const ACTIVE_STATUSES = new Set(['active', 'open', 'current', 'monitoring', 'watch']);
  const COMPONENT_ID_FIELDS = ['pid', 'id', 'component_id', 'sku', 'part_number', 'model'];
  const PLATFORM_ID_FIELDS = ['id', 'pid', 'platform_id', 'uid', 'slug'];
  const COMPONENT_RELATION_FIELDS = [
    'compatible_platform', 'compatible_platforms', 'platform', 'platforms',
    'platform_ids', 'used_in', 'used_by', 'applications', 'airframes'
  ];
  const PLATFORM_RELATION_FIELDS = [
    'component_id', 'component_ids', 'components', 'parts', 'bom',
    'bill_of_materials', 'standard_components', 'payloads', 'subsystems'
  ];
  const COMPATIBILITY_FIELDS = [
    'subcategory', 'protocol', 'interface', 'connector', 'frequency_ghz',
    'video_system', 'size_class', 'mounting_pattern_mm',
    'fc_mounting_patterns_mm', 'cell_count', 'cell_count_min',
    'cell_count_max', 'voltage_v', 'voltage_min_v', 'voltage_max_v',
    'mcu_family', 'firmware_targets', 'esc_firmware', 'stator_size',
    'kv_rating', 'prop_size_max_in', 'payload_kg', 'rangefinder',
    'polarization', 'bands', 'sbc_family', 'vehicle_type', 'type'
  ];
  const DISPLAY_SKIP = new Set([
    'pid', 'id', 'component_id', 'platform_id', 'name', 'platform_name',
    'manufacturer', 'description', 'notes', 'image_file', 'image_url',
    'link', 'links', 'product_url', 'datasheet_url', 'manual_link',
    'source', 'verification', 'source_needed', 'category', '_category',
    '_source', '_key', '_record_kind', '_raw'
  ]);

  function normalize(value) {
    if (signalsApi && typeof signalsApi.normalize === 'function') {
      return signalsApi.normalize(value);
    }
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function slugify(value) {
    return normalize(value).replace(/ /g, '-');
  }

  function firstValue(record, fields) {
    const row = record || {};
    for (const field of fields) {
      const value = row[field];
      if (value !== null && value !== undefined && String(value).trim() !== '') return value;
    }
    return '';
  }

  function recordName(record, kind) {
    const row = record || {};
    return String(kind === 'platform'
      ? (row.platform_name || row.name || row.model || '')
      : (row.name || row.model || row.part_number || '')).trim();
  }

  function recordManufacturer(record) {
    const row = record || {};
    return String(row.manufacturer || row.vendor || row.oem || '').trim();
  }

  function componentKey(record, category) {
    const direct = firstValue(record, COMPONENT_ID_FIELDS);
    if (direct) return String(direct).trim();
    return [category || record && (record._category || record.category), recordManufacturer(record), recordName(record, 'component')]
      .map(slugify).filter(Boolean).join('::');
  }

  function platformKey(record) {
    const direct = firstValue(record, PLATFORM_ID_FIELDS);
    if (direct) return String(direct).trim();
    return [recordManufacturer(record), recordName(record, 'platform')]
      .map(slugify).filter(Boolean).join('::');
  }

  function componentUrl(recordOrId) {
    const id = typeof recordOrId === 'object'
      ? componentKey(recordOrId, recordOrId && (recordOrId._category || recordOrId.category))
      : String(recordOrId || '').trim();
    return `/dossier/?component=${encodeURIComponent(id)}`;
  }

  function platformUrl(recordOrId) {
    const id = typeof recordOrId === 'object' ? platformKey(recordOrId) : String(recordOrId || '').trim();
    return `/dossier/?platform=${encodeURIComponent(id)}`;
  }

  function manufacturerUrl(value) {
    const slug = slugify(value);
    return slug ? `/dossier/?m=${encodeURIComponent(slug)}` : '/dossier/';
  }

  function flattenComponents(database) {
    const db = database && typeof database === 'object' ? database : {};
    const groups = db.components && typeof db.components === 'object' ? db.components : {};
    const rows = [];
    for (const [category, items] of Object.entries(groups)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        rows.push(Object.assign({}, item, {
          _category: category,
          _record_kind: 'component',
          _key: componentKey(item, category),
          _raw: item
        }));
      }
    }
    return rows;
  }

  function normalizePlatform(record, source) {
    if (!record || typeof record !== 'object') return null;
    const industry = record.industry_data && typeof record.industry_data === 'object'
      ? record.industry_data
      : {};
    const compliance = record.compliance && typeof record.compliance === 'object'
      ? record.compliance
      : {};
    const rawSpecs = record.specs && typeof record.specs === 'object' ? record.specs : {};
    const specs = Object.assign({}, industry.specs || {}, rawSpecs);
    if (record.vehicle_type != null && specs.type == null) specs.type = record.vehicle_type;
    if (record.max_flight_time_min != null && specs.flight_time_min == null) specs.flight_time_min = record.max_flight_time_min;
    if (record.max_payload_kg != null && specs.payload_kg == null) specs.payload_kg = record.max_payload_kg;
    if (record.mtow_kg != null && specs.mtow_kg == null) specs.mtow_kg = record.mtow_kg;
    if (record.max_range_km != null && specs.max_range_km == null && specs.range_km == null) specs.max_range_km = record.max_range_km;
    if (record.max_speed_kmh != null && specs.max_speed_kmh == null && specs.speed_kmh == null) specs.max_speed_kmh = record.max_speed_kmh;

    const normalized = Object.assign({}, record, {
      id: String(firstValue(record, PLATFORM_ID_FIELDS) || '').trim(),
      platform_name: recordName(record, 'platform'),
      manufacturer: recordManufacturer(record),
      manufacturer_hq: record.manufacturer_hq || industry.manufacturer_hq || record.country || '',
      manufacturer_url: record.manufacturer_url || industry.manufacturer_url || '',
      doc_url: record.doc_url || industry.doc_url || '',
      image_url: record.image_url || record.image_file || industry.image_url || '',
      category: record.category || record.build_class || record.platform_category || '',
      compliance: {
        blue_uas: compliance.blue_uas === true || record.blue_uas === true,
        ndaa_compliant: compliance.ndaa_compliant === true || record.ndaa_compliant === true,
        note: compliance.note || record.ndaa_note || ''
      },
      specs,
      variants: record.variants || industry.variants || [],
      contracts: record.contracts || industry.contracts || [],
      funding: record.funding || industry.funding || {},
      production: record.production || industry.production || {},
      gcs: record.gcs || industry.gcs || {},
      tags: Array.from(new Set([
        record.category, record.build_class, record.platform_category,
        ...(Array.isArray(record.tags) ? record.tags : [])
      ].filter(Boolean))),
      _source: source || record._source || 'unknown',
      _record_kind: 'platform',
      _raw: record
    });
    normalized._key = platformKey(normalized);
    return normalized;
  }

  function flattenPlatforms(database, intelPlatforms) {
    const db = database && typeof database === 'object' ? database : {};
    const candidates = [];
    const addAll = (rows, source) => {
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        const normalized = normalizePlatform(row, source);
        if (normalized && normalized.platform_name) candidates.push(normalized);
      }
    };
    addAll(db.drone_models, 'forge_database.drone_models');
    addAll(db.industry && db.industry.platforms, 'forge_database.industry.platforms');
    addAll(intelPlatforms, 'intel_platforms');

    const byIdentity = new Map();
    for (const row of candidates) {
      const identity = normalize(row.id) || normalize(`${row.manufacturer} ${row.platform_name}`);
      if (!identity) continue;
      const existing = byIdentity.get(identity);
      if (!existing) {
        byIdentity.set(identity, row);
        continue;
      }
      const merged = Object.assign({}, existing, row, {
        specs: Object.assign({}, existing.specs || {}, row.specs || {}),
        compliance: Object.assign({}, existing.compliance || {}, row.compliance || {}),
        tags: Array.from(new Set([...(existing.tags || []), ...(row.tags || [])])),
        _source: `${existing._source}; ${row._source}`
      });
      merged._key = platformKey(merged);
      byIdentity.set(identity, merged);
    }
    return Array.from(byIdentity.values());
  }

  function identityAliases(record, kind) {
    const aliases = new Set();
    const fields = kind === 'platform' ? PLATFORM_ID_FIELDS : COMPONENT_ID_FIELDS;
    for (const field of fields) {
      const value = record && record[field];
      if (value != null && String(value).trim()) aliases.add(normalize(value));
    }
    const name = recordName(record, kind);
    const manufacturer = recordManufacturer(record);
    if (name) aliases.add(normalize(name));
    if (manufacturer && name) aliases.add(normalize(`${manufacturer} ${name}`));
    if (record && record._key) aliases.add(normalize(record._key));
    return Array.from(aliases).filter(Boolean);
  }

  function resolveRecord(records, query, kind) {
    const rows = Array.isArray(records) ? records : [];
    const raw = String(query == null ? '' : query).trim();
    const wanted = normalize(raw);
    if (!wanted) return { record: null, matches: [], ambiguous: false, match_type: 'none' };

    const fields = kind === 'platform' ? PLATFORM_ID_FIELDS : COMPONENT_ID_FIELDS;
    const exactId = rows.filter(row => fields.some(field => normalize(row && row[field]) === wanted));
    if (exactId.length === 1) return { record: exactId[0], matches: exactId, ambiguous: false, match_type: 'id' };
    if (exactId.length > 1) return { record: null, matches: exactId, ambiguous: true, match_type: 'id' };

    const exactKey = rows.filter(row => normalize(row && row._key) === wanted);
    if (exactKey.length === 1) return { record: exactKey[0], matches: exactKey, ambiguous: false, match_type: 'key' };
    if (exactKey.length > 1) return { record: null, matches: exactKey, ambiguous: true, match_type: 'key' };

    const exactAlias = rows.filter(row => identityAliases(row, kind).includes(wanted));
    if (exactAlias.length === 1) return { record: exactAlias[0], matches: exactAlias, ambiguous: false, match_type: 'alias' };
    return {
      record: exactAlias.length === 1 ? exactAlias[0] : null,
      matches: exactAlias,
      ambiguous: exactAlias.length > 1,
      match_type: exactAlias.length ? 'alias' : 'none'
    };
  }

  function collectReferences(value, output, depth) {
    const target = output || new Set();
    const level = depth || 0;
    if (level > 4 || value == null) return target;
    if (typeof value === 'string' || typeof value === 'number') {
      const normalized = normalize(value);
      if (normalized) target.add(normalized);
      return target;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectReferences(item, target, level + 1);
      return target;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (/^(id|pid|uid|name|model|sku|part_number|component_id|platform_id|platform_name)$/i.test(key)) {
          collectReferences(child, target, level + 1);
        } else if (level < 2 && /^(components?|parts?|platforms?|bom|relations?|items?|subsystems?|payloads?)$/i.test(key)) {
          collectReferences(child, target, level + 1);
        }
      }
    }
    return target;
  }

  function referencesFromFields(record, fields) {
    const refs = new Set();
    const row = record || {};
    for (const field of fields) collectReferences(row[field], refs, 0);
    const relations = row.relations;
    if (relations && typeof relations === 'object') {
      for (const field of fields) collectReferences(relations[field], refs, 0);
      collectReferences(relations, refs, 0);
    }
    return refs;
  }

  function aliasesIntersect(refs, aliases) {
    for (const alias of aliases) if (refs.has(alias)) return alias;
    return '';
  }

  function findRelatedPlatforms(component, platforms) {
    if (!component) return [];
    const componentAliases = identityAliases(component, 'component');
    const componentRefs = referencesFromFields(component, COMPONENT_RELATION_FIELDS);
    const results = [];
    for (const platform of platforms || []) {
      const platformAliases = identityAliases(platform, 'platform');
      const platformRefs = referencesFromFields(platform, PLATFORM_RELATION_FIELDS);
      const viaComponent = aliasesIntersect(componentRefs, platformAliases);
      const viaPlatform = aliasesIntersect(platformRefs, componentAliases);
      if (!viaComponent && !viaPlatform) continue;
      results.push(Object.assign({}, platform, {
        _relationship_confidence: 'direct',
        _relationship_reason: viaComponent
          ? `component relationship references ${viaComponent}`
          : `platform BOM/relationship references ${viaPlatform}`
      }));
    }
    return results.sort((a, b) => recordName(a, 'platform').localeCompare(recordName(b, 'platform')));
  }

  function findPlatformComponents(platform, components) {
    if (!platform) return [];
    const platformAliases = identityAliases(platform, 'platform');
    const platformRefs = referencesFromFields(platform, PLATFORM_RELATION_FIELDS);
    const results = [];
    for (const component of components || []) {
      const componentAliases = identityAliases(component, 'component');
      const componentRefs = referencesFromFields(component, COMPONENT_RELATION_FIELDS);
      const viaPlatform = aliasesIntersect(platformRefs, componentAliases);
      const viaComponent = aliasesIntersect(componentRefs, platformAliases);
      if (!viaPlatform && !viaComponent) continue;
      results.push(Object.assign({}, component, {
        _relationship_confidence: 'direct',
        _relationship_reason: viaPlatform
          ? `platform BOM/relationship references ${viaPlatform}`
          : `component relationship references ${viaComponent}`
      }));
    }
    return results.sort((a, b) => String(a._category || '').localeCompare(String(b._category || '')) || recordName(a, 'component').localeCompare(recordName(b, 'component')));
  }

  function comparableValue(value) {
    if (Array.isArray(value)) return value.map(normalize).filter(Boolean).sort().join('|');
    if (value && typeof value === 'object') return '';
    return normalize(value);
  }

  function candidateAlternatives(record, records, kind, limit) {
    if (!record) return [];
    const max = Number.isFinite(limit) ? Math.max(0, limit) : 8;
    const category = normalize(kind === 'platform'
      ? record.category
      : (record._category || record.category));
    const currentKey = kind === 'platform' ? platformKey(record) : componentKey(record, record._category || record.category);
    const candidates = [];
    for (const row of records || []) {
      const rowKey = kind === 'platform' ? platformKey(row) : componentKey(row, row._category || row.category);
      if (!rowKey || normalize(rowKey) === normalize(currentKey)) continue;
      const rowCategory = normalize(kind === 'platform' ? row.category : (row._category || row.category));
      if (category && rowCategory !== category) continue;

      const matched = [];
      for (const field of COMPATIBILITY_FIELDS) {
        const left = comparableValue(record[field] != null ? record[field] : record.specs && record.specs[field]);
        const right = comparableValue(row[field] != null ? row[field] : row.specs && row.specs[field]);
        if (left && right && left === right) matched.push(field);
      }
      let score = matched.length * 3;
      if (recordManufacturer(row) && normalize(recordManufacturer(row)) !== normalize(recordManufacturer(record))) score += 1;
      if (row.ndaa_compliant === true || row.compliance && row.compliance.ndaa_compliant === true) score += 1;
      if (row.verification && normalize(row.verification.status) !== 'unverified') score += 1;
      candidates.push(Object.assign({}, row, {
        _alternative_score: score,
        _matched_fields: matched,
        _alternative_caveat: 'Candidate in the same indexed category. Compatibility, qualification, availability, and compliance must be verified; this is not a drop-in-replacement determination.'
      }));
    }
    return candidates.sort((a, b) => b._alternative_score - a._alternative_score || recordName(a, kind).localeCompare(recordName(b, kind))).slice(0, max);
  }

  function isActiveFlag(flag) {
    const status = normalize(flag && (flag.status || 'active'));
    return !status || ACTIVE_STATUSES.has(status);
  }

  function flagCorpus(flag) {
    if (signalsApi && typeof signalsApi.flagText === 'function') return signalsApi.flagText(flag);
    const row = flag || {};
    return normalize([row.title, row.detail, row.summary, row.description, row.entity, row.manufacturer, row.vendor, row.component_id, row.platform_id].filter(Boolean).join(' '));
  }

  function matchRecordFlag(flag, kind, record) {
    if (!flag || !record || !isActiveFlag(flag)) return null;
    const reasons = [];
    const aliases = identityAliases(record, kind);
    const text = flagCorpus(flag);
    const directField = kind === 'platform' ? flag.platform_id : flag.component_id;
    if (directField && aliases.includes(normalize(directField))) reasons.push(kind === 'platform' ? 'platform' : 'component');

    const manufacturer = recordManufacturer(record);
    const flagManufacturer = normalize(flag.manufacturer || flag.vendor);
    if (manufacturer && flagManufacturer && flagManufacturer === normalize(manufacturer)) reasons.push('manufacturer');

    const name = normalize(recordName(record, kind));
    if (name && (` ${text} `).includes(` ${name} `)) reasons.push('text');

    const category = normalize(kind === 'platform' ? record.category : (record._category || record.category));
    const flagCategory = normalize(flag.component_category || flag.platform_category || flag.category);
    if (category && flagCategory && category === flagCategory) reasons.push('category');

    if (!reasons.length && kind === 'component' && signalsApi && typeof signalsApi.matchFlag === 'function') {
      const vendorSlug = slugify(manufacturer);
      const vendor = { name: manufacturer, aliases: manufacturer ? [manufacturer] : [] };
      const vendorMatch = signalsApi.matchFlag(flag, vendorSlug, vendor, [record]);
      if (vendorMatch) reasons.push(...(vendorMatch._match_reasons || []));
    }

    if (!reasons.length) return null;
    const direct = reasons.some(reason => ['component', 'platform', 'manufacturer', 'entity'].includes(reason));
    return Object.assign({}, flag, {
      _match_reasons: Array.from(new Set(reasons)),
      _match_confidence: direct ? 'direct' : 'contextual'
    });
  }

  function matchRecordFlags(flags, kind, record) {
    const rows = (Array.isArray(flags) ? flags : []).map(flag => matchRecordFlag(flag, kind, record)).filter(Boolean);
    if (signalsApi && typeof signalsApi.sortSignals === 'function') return signalsApi.sortSignals(rows);
    return rows;
  }

  function catalogEntry(catalog, id) {
    const doc = catalog && typeof catalog === 'object' ? catalog : {};
    return (Array.isArray(doc.datasets) ? doc.datasets : []).find(row => row && row.id === id) || null;
  }

  function safeHttpUrl(value) {
    const raw = String(value == null ? '' : value).trim();
    return /^https?:\/\//i.test(raw) ? raw : '';
  }

  function sourceUrl(record) {
    const row = record || {};
    const candidates = [];
    if (Array.isArray(row.links)) candidates.push(...row.links);
    candidates.push(row.link, row.product_url, row.datasheet_url, row.manual_link, row.doc_url, row.manufacturer_url);
    if (typeof row.source === 'string' && !['internal_archetype', 'null'].includes(row.source)) candidates.push(row.source);
    return candidates.map(safeHttpUrl).find(Boolean) || '';
  }

  function complianceSummary(record) {
    const row = record || {};
    const comp = row.compliance && typeof row.compliance === 'object' ? row.compliance : {};
    return {
      ndaa: row.ndaa_compliant === true || comp.ndaa_compliant === true,
      blue: row.blue_uas === true || comp.blue_uas === true,
      note: row.ndaa_note || comp.note || '',
      country: row.manufacturer_country || row.country || row.country_of_origin || row.manufacturer_hq || ''
    };
  }

  function scalarEntries(record) {
    const rows = [];
    for (const [key, value] of Object.entries(record || {})) {
      if (DISPLAY_SKIP.has(key) || key.startsWith('_')) continue;
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'object' && !Array.isArray(value)) continue;
      const display = Array.isArray(value) ? value.join(', ') : String(value);
      if (!display || display.length > 420) continue;
      rows.push([key, display]);
    }
    return rows;
  }

  function relationshipRows(record, kind) {
    const fields = kind === 'platform'
      ? [...PLATFORM_RELATION_FIELDS, 'relations']
      : [...COMPONENT_RELATION_FIELDS, 'dependencies', 'requires', 'compatible_with', 'relations'];
    const rows = [];
    for (const field of fields) {
      const value = record && record[field];
      if (value == null || value === '' || Array.isArray(value) && !value.length) continue;
      let display;
      if (typeof value === 'object') {
        try { display = JSON.stringify(value); } catch (_) { display = String(value); }
      } else display = String(value);
      if (display.length > 600) display = display.slice(0, 597) + '…';
      rows.push([field, display]);
    }
    return rows;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function label(value) {
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  }

  function formatDate(value) {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) return value ? String(value) : '—';
    return new Date(parsed).toISOString().slice(0, 10);
  }

  function renderPairs(rows, emptyText) {
    if (!rows.length) return `<div class="frd-empty">${escapeHtml(emptyText || 'No structured fields are recorded.')}</div>`;
    return `<div class="frd-pairs">${rows.map(([key, value]) => `
      <div class="frd-pair"><div class="frd-pair-key">${escapeHtml(label(key))}</div><div class="frd-pair-value">${escapeHtml(value)}</div></div>
    `).join('')}</div>`;
  }

  function renderSources(sources) {
    const rows = Array.isArray(sources) ? sources : [];
    if (!rows.length) return '<div class="frd-empty">No source references are attached to this signal.</div>';
    return `<div class="frd-source-list">${rows.slice(0, 8).map(source => {
      const url = safeHttpUrl(source && source.url);
      const name = source && (source.name || source.title || source.url || source.id) || 'Source';
      const type = source && source.type || 'unclassified';
      return `<div class="frd-source"><span>${escapeHtml(type)}</span>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(name)}</a>` : `<strong>${escapeHtml(name)}</strong>`}</div>`;
    }).join('')}</div>`;
  }

  function renderSignals(signals) {
    if (!signals.length) {
      return `<div class="frd-empty">No current indexed Patterns signal matched this exact record. This is not evidence that no risk, restriction, capability, funding, or relevant reporting exists.</div>`;
    }
    return `<div class="frd-signal-list">${signals.slice(0, 12).map(signal => `
      <article class="frd-signal ${escapeHtml(normalize(signal.severity || 'unknown').split(' ')[0])}">
        <div class="frd-signal-head"><strong>${escapeHtml(signal.title || signal.id || 'Indexed signal')}</strong><span>${escapeHtml(signal.severity || 'unknown')} · ${escapeHtml(signal._match_confidence || 'contextual')}</span></div>
        ${signal.detail || signal.summary || signal.description ? `<p>${escapeHtml(signal.detail || signal.summary || signal.description)}</p>` : ''}
        <div class="frd-signal-meta">Match: ${escapeHtml((signal._match_reasons || []).join(', ') || 'context')} · Last seen: ${escapeHtml(formatDate(signal.last_seen || signal.timestamp || signal.date))}</div>
        ${renderSources(signal.sources)}
      </article>
    `).join('')}</div>`;
  }

  function renderRecordCards(records, kind, emptyText) {
    if (!records.length) return `<div class="frd-empty">${escapeHtml(emptyText)}</div>`;
    return `<div class="frd-card-grid">${records.map(record => {
      const url = kind === 'platform' ? platformUrl(record) : componentUrl(record);
      const title = recordName(record, kind) || (kind === 'platform' ? platformKey(record) : componentKey(record, record._category || record.category));
      const subtitle = kind === 'platform'
        ? [recordManufacturer(record), record.category].filter(Boolean).join(' · ')
        : [recordManufacturer(record), record._category || record.category].filter(Boolean).join(' · ');
      const reason = record._relationship_reason || record._alternative_caveat || '';
      const match = record._matched_fields && record._matched_fields.length ? `Matched fields: ${record._matched_fields.map(label).join(', ')}` : '';
      return `<a class="frd-card" href="${escapeHtml(url)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span>${match ? `<small>${escapeHtml(match)}</small>` : ''}${reason ? `<small>${escapeHtml(reason)}</small>` : ''}</a>`;
    }).join('')}</div>`;
  }

  function trustBlock(kind, catalog) {
    const primaryId = kind === 'platform' ? 'platform_catalog' : 'parts_catalog';
    const primary = catalogEntry(catalog, primaryId);
    const flags = catalogEntry(catalog, 'flags');
    const values = [primary, flags].filter(Boolean);
    return `<div class="frd-trust">
      <strong>Coverage and limitations</strong>
      <p>Forge reference records and Patterns signals are public-source decision support. They are not a legal, procurement, export-control, airworthiness, security, compatibility, or operational determination.</p>
      ${values.length ? `<div class="frd-trust-grid">${values.map(row => `<div><span>${escapeHtml(row.label || row.id)}</span><b>${escapeHtml(row.status || 'unknown')}</b><small>Generated ${escapeHtml(formatDate(row.generated_at))} · Coverage through ${escapeHtml(formatDate(row.coverage_end))}</small><small>${escapeHtml(row.caveat || '')}</small></div>`).join('')}</div>` : '<p>Dataset catalog metadata was unavailable. Verify freshness directly before relying on the record.</p>'}
    </div>`;
  }

  function permalinkButton() {
    return `<button class="frd-copy" type="button" data-copy-permalink>Copy permalink</button>`;
  }

  function renderComponentPage(component, context) {
    const components = context.components;
    const platforms = context.platforms;
    const flags = context.flags;
    const catalog = context.catalog;
    const compliance = complianceSummary(component);
    const relatedPlatforms = findRelatedPlatforms(component, platforms);
    const alternatives = candidateAlternatives(component, components, 'component', 8);
    const matchedSignals = matchRecordFlags(flags, 'component', component);
    const source = sourceUrl(component);
    const manufacturer = recordManufacturer(component);
    const scalar = scalarEntries(component);
    const relations = relationshipRows(component, 'component');
    const verified = component.verification && normalize(component.verification.status) !== 'unverified';

    document.title = `${recordName(component, 'component')} — Component Dossier — Forge`;
    return `
      <div class="frd-back"><a href="/browse/">← Browse components</a><a href="/dossier/">Manufacturer dossiers</a></div>
      <header class="frd-hero">
        <div><div class="frd-eyebrow">Forge · Component dossier · ${escapeHtml(component._key)}</div><h1>${escapeHtml(recordName(component, 'component') || component._key)}</h1><p>${escapeHtml(component.description || 'No component description is recorded.')}</p></div>
        <div class="frd-actions">${permalinkButton()}${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Primary/product source ↗</a>` : ''}</div>
      </header>
      <div class="frd-kpis">
        <div><span>Category</span><b>${escapeHtml(component._category || component.category || 'Unknown')}</b></div>
        <div><span>Manufacturer</span><b>${manufacturer ? `<a href="${escapeHtml(manufacturerUrl(manufacturer))}">${escapeHtml(manufacturer)}</a>` : 'Unknown'}</b></div>
        <div><span>Origin</span><b>${escapeHtml(compliance.country || 'Unknown')}</b></div>
        <div><span>NDAA signal</span><b>${compliance.ndaa ? 'Recorded true' : 'Not established'}</b></div>
        <div><span>Blue UAS signal</span><b>${compliance.blue ? 'Recorded true' : 'Not established'}</b></div>
        <div><span>Verification</span><b>${verified ? 'Audited record' : component.source_needed ? 'Source needed' : 'Verify before reliance'}</b></div>
      </div>
      ${compliance.note ? `<div class="frd-notice">${escapeHtml(compliance.note)}</div>` : ''}
      <section class="frd-section"><h2>Engineering and procurement fields</h2>${renderPairs(scalar, 'No scalar specifications are recorded for this component.')}</section>
      <section class="frd-section"><h2>Compatibility and dependencies</h2>${renderPairs(relations, 'No explicit structured compatibility or dependency relationship is recorded. Absence is not proof of universal compatibility.')}</section>
      <section class="frd-section"><h2>Documented platform relationships <span>${relatedPlatforms.length}</span></h2>${renderRecordCards(relatedPlatforms, 'platform', 'No explicit platform relationship is recorded. Descriptive text is intentionally not treated as installation proof.')}</section>
      <section class="frd-section"><h2>Candidate alternatives <span>${alternatives.length}</span></h2><p class="frd-method">Same-category candidates are ranked by matching structured fields. Every candidate requires compatibility, qualification, availability, and compliance verification.</p>${renderRecordCards(alternatives, 'component', 'No same-category candidate alternatives were found in the indexed component catalog.')}</section>
      <section class="frd-section frd-patterns"><h2>Current Patterns signals <span>${matchedSignals.length}</span></h2><p class="frd-method">Direct identifiers and structured manufacturer fields outrank contextual text matches. Open the evidence before using any signal in a decision.</p>${renderSignals(matchedSignals)}<a class="frd-patterns-link" href="https://uas-patterns.com/patterns/">Open all Patterns flags →</a></section>
      ${trustBlock('component', catalog)}
    `;
  }

  function objectRows(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).map(([key, child]) => {
      if (Array.isArray(child)) return [key, child.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join('; ')];
      if (child && typeof child === 'object') return [key, JSON.stringify(child)];
      return [key, String(child)];
    }).filter(([, child]) => child && child !== 'undefined');
  }

  function renderPlatformPage(platform, context) {
    const components = context.components;
    const platforms = context.platforms;
    const flags = context.flags;
    const catalog = context.catalog;
    const compliance = complianceSummary(platform);
    const relatedComponents = findPlatformComponents(platform, components);
    const alternatives = candidateAlternatives(platform, platforms, 'platform', 8);
    const matchedSignals = matchRecordFlags(flags, 'platform', platform);
    const source = sourceUrl(platform);
    const manufacturer = recordManufacturer(platform);
    const relations = relationshipRows(platform, 'platform');
    const specs = objectRows(platform.specs || {});

    document.title = `${recordName(platform, 'platform')} — Platform Dossier — Forge`;
    return `
      <div class="frd-back"><a href="/platforms/">← Browse platforms</a><a href="/dossier/">Manufacturer dossiers</a></div>
      <header class="frd-hero">
        <div><div class="frd-eyebrow">Forge · Platform dossier · ${escapeHtml(platform._key)}</div><h1>${escapeHtml(recordName(platform, 'platform') || platform._key)}</h1><p>${escapeHtml(platform._description || platform.description || platform.notes || 'No platform description is recorded.')}</p></div>
        <div class="frd-actions">${permalinkButton()}${source ? `<a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Manufacturer/document source ↗</a>` : ''}</div>
      </header>
      <div class="frd-kpis">
        <div><span>Category</span><b>${escapeHtml(platform.category || 'Unknown')}</b></div>
        <div><span>Manufacturer</span><b>${manufacturer ? `<a href="${escapeHtml(manufacturerUrl(manufacturer))}">${escapeHtml(manufacturer)}</a>` : 'Unknown'}</b></div>
        <div><span>Country / HQ</span><b>${escapeHtml(compliance.country || 'Unknown')}</b></div>
        <div><span>Status</span><b>${escapeHtml(platform.status || 'Unknown')}</b></div>
        <div><span>NDAA signal</span><b>${compliance.ndaa ? 'Recorded true' : 'Not established'}</b></div>
        <div><span>Blue UAS signal</span><b>${compliance.blue ? 'Recorded true' : 'Not established'}</b></div>
      </div>
      ${compliance.note ? `<div class="frd-notice">${escapeHtml(compliance.note)}</div>` : ''}
      <section class="frd-section"><h2>Specifications</h2>${renderPairs(specs, 'No structured platform specifications are recorded.')}</section>
      <section class="frd-section"><h2>Variants, ground control, contracts, funding, and production</h2>${renderPairs([
        ...objectRows({ variants: platform.variants || [] }),
        ...objectRows(platform.gcs || {}).map(([key, value]) => [`gcs.${key}`, value]),
        ...objectRows({ contracts: platform.contracts || [] }),
        ...objectRows(platform.funding || {}).map(([key, value]) => [`funding.${key}`, value]),
        ...objectRows(platform.production || {}).map(([key, value]) => [`production.${key}`, value])
      ], 'No structured lifecycle or program fields are recorded.')}</section>
      <section class="frd-section"><h2>Components and BOM relationships <span>${relatedComponents.length}</span></h2>${renderPairs(relations, 'No explicit platform BOM or component relationship is recorded.')}${renderRecordCards(relatedComponents, 'component', 'No exact component relationship could be resolved against the current Forge catalog.')}</section>
      <section class="frd-section"><h2>Candidate peer platforms <span>${alternatives.length}</span></h2><p class="frd-method">Same-category peers are ranked by matching structured fields. This is not an equivalence, suitability, or replacement determination.</p>${renderRecordCards(alternatives, 'platform', 'No same-category peer platforms were found in the indexed catalog.')}</section>
      <section class="frd-section frd-patterns"><h2>Current Patterns signals <span>${matchedSignals.length}</span></h2><p class="frd-method">Exact platform identifiers and manufacturer fields outrank contextual text matches. Article or flag matches do not establish event-level attribution or capability.</p>${renderSignals(matchedSignals)}<a class="frd-patterns-link" href="https://uas-patterns.com/patterns/">Open all Patterns flags →</a></section>
      ${trustBlock('platform', catalog)}
    `;
  }

  function injectStyles() {
    if (document.getElementById('forge-record-dossier-styles')) return;
    const style = document.createElement('style');
    style.id = 'forge-record-dossier-styles';
    style.textContent = `
      .frd-empty{padding:22px;border:1px dashed #3e3e34;border-radius:8px;color:#8a8070;background:#141410;font:12px 'JetBrains Mono',monospace;line-height:1.6}
      .frd-back{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px}.frd-back a{color:#b8b0a0;font:600 11px 'JetBrains Mono',monospace;text-decoration:none}.frd-back a:hover{color:#dc2626}
      .frd-hero{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:22px;border:1px solid #2e2e26;border-left:4px solid #dc2626;border-radius:10px;background:#141410}.frd-hero h1{margin:4px 0 8px;color:#f5f0e8;font:700 26px 'JetBrains Mono',monospace}.frd-hero p{max-width:760px;color:#b8b0a0;font-size:13px;line-height:1.65}.frd-eyebrow{color:#8a8070;font:700 9px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.1em;overflow-wrap:anywhere}
      .frd-actions{display:flex;flex-direction:column;gap:8px;min-width:170px}.frd-actions a,.frd-copy{border:1px solid #3e3e34;border-radius:6px;background:#1c1c17;color:#f5f0e8;padding:8px 10px;font:600 10px 'JetBrains Mono',monospace;text-decoration:none;cursor:pointer;text-align:center}.frd-actions a:hover,.frd-copy:hover{border-color:#dc2626;color:#dc2626}
      .frd-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));margin:12px 0 18px;border:1px solid #2e2e26;border-radius:8px;overflow:hidden}.frd-kpis>div{padding:11px;background:#141410;border-right:1px solid #2e2e26}.frd-kpis>div:last-child{border-right:0}.frd-kpis span{display:block;color:#8a8070;font:600 8px 'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:.08em}.frd-kpis b{display:block;color:#f5f0e8;font-size:12px;margin-top:4px;overflow-wrap:anywhere}.frd-kpis a{color:#f5f0e8}
      .frd-notice{margin:0 0 18px;padding:10px 12px;border:1px solid rgba(201,162,39,.35);border-left:3px solid #c9a227;border-radius:6px;background:rgba(201,162,39,.08);color:#b8b0a0;font-size:11px;line-height:1.6}
      .frd-section{margin:18px 0;padding:17px;border:1px solid #2e2e26;border-radius:9px;background:#1c1c17}.frd-section h2{margin:0 0 12px;color:#f5f0e8;font:700 13px 'JetBrains Mono',monospace}.frd-section h2 span{color:#8a8070;font-size:10px}.frd-method{margin:-4px 0 12px;color:#8a8070;font-size:11px;line-height:1.6}
      .frd-pairs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.frd-pair{display:grid;grid-template-columns:minmax(120px,.7fr) minmax(0,1.3fr);gap:10px;padding:8px 9px;border-radius:6px;background:#141410}.frd-pair-key{color:#8a8070;font:600 9px 'JetBrains Mono',monospace}.frd-pair-value{color:#f5f0e8;font-size:11px;overflow-wrap:anywhere}
      .frd-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}.frd-card{display:flex;flex-direction:column;gap:4px;padding:11px;border:1px solid #2e2e26;border-radius:7px;background:#141410;text-decoration:none}.frd-card:hover{border-color:#dc2626}.frd-card strong{color:#f5f0e8;font-size:12px}.frd-card span{color:#8a8070;font:500 9px 'JetBrains Mono',monospace}.frd-card small{color:#b8b0a0;font-size:10px;line-height:1.45}
      .frd-patterns{border-left:3px solid #22c55e}.frd-signal-list{display:grid;gap:8px}.frd-signal{padding:11px;border:1px solid #2e2e26;border-left:3px solid #8a8070;border-radius:7px;background:#141410}.frd-signal.critical{border-left-color:#ef4444}.frd-signal.high{border-left-color:#f97316}.frd-signal.warning,.frd-signal.medium{border-left-color:#f59e0b}.frd-signal-head{display:flex;justify-content:space-between;gap:10px}.frd-signal-head strong{color:#f5f0e8;font-size:12px}.frd-signal-head span,.frd-signal-meta{color:#8a8070;font:600 9px 'JetBrains Mono',monospace}.frd-signal p{margin:7px 0;color:#b8b0a0;font-size:11px;line-height:1.55}.frd-source-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.frd-source{display:flex;gap:5px;padding:4px 6px;border-radius:4px;background:#1c1c17;font:500 9px 'JetBrains Mono',monospace}.frd-source span{color:#8a8070}.frd-source a,.frd-source strong{color:#40916c}.frd-patterns-link{display:inline-block;margin-top:12px;color:#22c55e;font:600 10px 'JetBrains Mono',monospace;text-decoration:none}
      .frd-trust{margin:18px 0;padding:15px;border:1px solid #2e2e26;border-left:3px solid #40916c;border-radius:8px;background:#141410;color:#b8b0a0;font-size:11px;line-height:1.6}.frd-trust>strong{color:#f5f0e8;font:700 11px 'JetBrains Mono',monospace}.frd-trust-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.frd-trust-grid>div{display:flex;flex-direction:column;padding:9px;background:#1c1c17;border-radius:6px}.frd-trust-grid span{color:#f5f0e8;font-weight:600}.frd-trust-grid b{color:#40916c;font:600 9px 'JetBrains Mono',monospace}.frd-trust-grid small{color:#8a8070;margin-top:3px}
      @media(max-width:820px){.frd-hero{display:block}.frd-actions{margin-top:14px;min-width:0;flex-direction:row;flex-wrap:wrap}.frd-kpis{grid-template-columns:repeat(2,1fr)}.frd-kpis>div{border-bottom:1px solid #2e2e26}.frd-pairs,.frd-trust-grid{grid-template-columns:1fr}.frd-pair{grid-template-columns:1fr}.frd-signal-head{display:block}.frd-signal-head span{display:block;margin-top:3px}}
    `;
    document.head.appendChild(style);
  }

  async function fetchFirst(urls, fallback) {
    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const value = await response.json();
        return value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
      } catch (_) {
        // Try next source.
      }
    }
    return fallback;
  }

  async function waitForManufacturerPage(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < (timeoutMs || 10000)) {
      const grid = document.getElementById('picker-grid');
      if (!grid || grid.childElementCount || grid.textContent.trim()) return;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  }

  async function loadBrowserContext() {
    const [database, intelPlatforms, flags, catalog] = await Promise.all([
      fetchFirst(['/static/forge_database.json', '/forge_database.json'], { components: {}, drone_models: [], industry: {} }),
      fetchFirst(['/intel_platforms.json', '/static/intel_platforms.json'], []),
      fetchFirst(['/api/data?type=pie_flags', '/static/pie_flags.json', '/pie_flags.json'], []),
      fetchFirst(['/api/data?type=dataset_catalog', '/static/dataset_catalog.json', '/dataset_catalog.json'], { datasets: [] })
    ]);
    return {
      database,
      components: flattenComponents(database),
      platforms: flattenPlatforms(database, Array.isArray(intelPlatforms) ? intelPlatforms : []),
      flags: Array.isArray(flags) ? flags : [],
      catalog: catalog && typeof catalog === 'object' ? catalog : { datasets: [] }
    };
  }

  function bindCopyButton(main) {
    const button = main.querySelector('[data-copy-permalink]');
    if (!button) return;
    button.addEventListener('click', async function () {
      try {
        await navigator.clipboard.writeText(location.href);
        button.textContent = 'Permalink copied';
      } catch (_) {
        const input = document.createElement('input');
        input.value = location.href;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        button.textContent = 'Permalink copied';
      }
      setTimeout(() => { button.textContent = 'Copy permalink'; }, 1800);
    });
  }

  function renderResolutionError(main, kind, query, result) {
    const matches = result && Array.isArray(result.matches) ? result.matches : [];
    const suggestion = matches.length
      ? `<div class="frd-card-grid">${matches.slice(0, 12).map(row => `<a class="frd-card" href="${escapeHtml(kind === 'platform' ? platformUrl(row) : componentUrl(row))}"><strong>${escapeHtml(recordName(row, kind))}</strong><span>${escapeHtml(kind === 'platform' ? recordManufacturer(row) : row._category || row.category || '')}</span></a>`).join('')}</div>`
      : '';
    main.innerHTML = `<div class="frd-back"><a href="${kind === 'platform' ? '/platforms/' : '/browse/'}">← Return to catalog</a></div><div class="frd-empty"><strong>${result && result.ambiguous ? 'Ambiguous record identifier' : 'Record not found'}</strong><br>The ${escapeHtml(kind)} identifier <code>${escapeHtml(query)}</code> did not resolve to one exact public record. Use the stable catalog identifier rather than a descriptive name.${suggestion}</div>`;
  }

  async function bootstrapFromLocation() {
    if (typeof document === 'undefined' || typeof location === 'undefined') return false;
    const params = new URLSearchParams(location.search);
    const componentQuery = params.get('component');
    const platformQuery = params.get('platform');
    if (!componentQuery && !platformQuery) return false;

    await waitForManufacturerPage(10000);
    injectStyles();
    const main = document.querySelector('main');
    if (!main) throw new Error('dossier main element not found');
    main.innerHTML = '<div class="frd-empty">Loading the record, evidence, and coverage metadata…</div>';

    const context = await loadBrowserContext();
    const kind = componentQuery ? 'component' : 'platform';
    const query = componentQuery || platformQuery;
    const result = resolveRecord(kind === 'component' ? context.components : context.platforms, query, kind);
    if (!result.record) {
      renderResolutionError(main, kind, query, result);
      return false;
    }

    main.innerHTML = kind === 'component'
      ? renderComponentPage(result.record, context)
      : renderPlatformPage(result.record, context);
    bindCopyButton(main);
    const navLabel = document.getElementById('dc-nav-page');
    if (navLabel) navLabel.textContent = kind === 'component' ? 'Component Dossier' : 'Platform Dossier';
    if (window.__forgeAnalytics && typeof window.__forgeAnalytics.view === 'function') {
      const row = result.record;
      window.__forgeAnalytics.view(
        kind === 'component' ? componentKey(row, row._category || row.category) : platformKey(row),
        kind === 'component' ? row._category || row.category || '' : row.category || '',
        recordManufacturer(row),
        complianceSummary(row).country,
        complianceSummary(row).ndaa
      );
    }
    return true;
  }

  return {
    normalize,
    slugify,
    recordName,
    recordManufacturer,
    componentKey,
    platformKey,
    componentUrl,
    platformUrl,
    manufacturerUrl,
    flattenComponents,
    normalizePlatform,
    flattenPlatforms,
    identityAliases,
    resolveRecord,
    collectReferences,
    referencesFromFields,
    findRelatedPlatforms,
    findPlatformComponents,
    candidateAlternatives,
    matchRecordFlag,
    matchRecordFlags,
    catalogEntry,
    sourceUrl,
    complianceSummary,
    scalarEntries,
    relationshipRows,
    bootstrapFromLocation
  };
});
