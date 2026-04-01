(function () {
    'use strict';

    let allPlatforms = [];
    let activeFilter = null;

    // ── Clean unified category taxonomy ──
    const UNIFIED_CATS = {
        // Map raw build_class / industry category → clean group
        'enterprise_cots': 'enterprise', 'enterprise_blue_uas': 'blue_uas', 'enterprise': 'enterprise',
        'cots_enterprise': 'enterprise', 'commercial': 'enterprise', 'complete_platform': 'enterprise',
        'tactical_blue_uas': 'blue_uas',
        'tactical_fpv': 'tactical', 'tactical_defense': 'tactical', 'tactical_indoor': 'tactical',
        'tactical': 'tactical', 'defense': 'tactical',
        'tethered': 'tethered', 'tethered_persistent': 'tethered',
        'agriculture': 'agriculture',
        'mapping': 'mapping',
        'delivery': 'specialty', 'confined_space': 'specialty', 'cargo': 'specialty',
        'development': 'open_source', 'open_source': 'open_source',
        // FPV / strike
        'fpv_strike': 'tactical', 'fpv_strike_fiber': 'tactical', 'fpv_strike_and_tactical': 'tactical',
        'fpv_multirole': 'tactical', 'fpv': 'tactical', 'fpv_indoor_recon': 'tactical',
        'expendable_strike': 'tactical', 'armed_multirotor': 'tactical',
        'heavy_multirotor_strike': 'tactical', 'fixed_wing_strike': 'tactical',
        'deep_strike': 'tactical', 'deep_strike_kamikaze': 'tactical', 'deep_strike_owa': 'tactical',
        'ai_fpv_swarm': 'tactical', 'swarm_autonomy': 'tactical',
        // ISR
        'fpv_isr': 'isr', 'fpv_isr_dev': 'isr', 'tactical_isr': 'isr',
        'nano_isr': 'isr', 'micro_isr': 'isr', 'mini_isr': 'isr',
        'commercial_isr': 'isr', 'deep_isr': 'isr', 'rotary_maritime_isr': 'isr',
        'tactical_isr_and_lm': 'isr',
        // Loitering munition
        'loitering_munition': 'loitering', 'micro_indoor_lm': 'loitering',
        // Fixed wing
        'fixed_wing_isr': 'fixed_wing', 'fixed_wing_vtol': 'fixed_wing',
        'group3_vtol_isr': 'fixed_wing', 'evtol_fixed_wing_isr': 'fixed_wing',
        'vtol_fixed_wing_isr': 'fixed_wing', 'vtol_isr': 'fixed_wing',
        'group3_plus_isr': 'fixed_wing', 'group3_tactical_male': 'fixed_wing',
        // UCAV / heavy
        'male_ucav': 'ucav', 'male_ucav_and_lm': 'ucav', 'male_isr': 'ucav',
        'jet_ucav': 'ucav', 'heavy_ucav': 'ucav', 'stealth_ucav': 'ucav',
        'loyal_wingman_ucav': 'ucav', 'tactical_ucav': 'ucav',
        'group3_plus_ucav': 'ucav', 'autonomous_combat': 'ucav',
        'armed_helo_uav': 'ucav',
        // Specialty
        'heavy_lift_multi_mission': 'specialty', 'heavy_lift_vtol': 'specialty',
        'modular_multi_mission': 'specialty', 'counter_uas': 'specialty',
        'naval': 'specialty',
        // FPV build classes (from parts DB)
        '5inch_freestyle': 'tactical', '5inch_racing': 'tactical',
        '6inch_long_range': 'tactical', '7inch_long_range': 'tactical',
        '7inch_cinematic': 'tactical', '10inch_cinelifter': 'specialty',
        // Catch-all for autonomous interceptor
        'autonomous_interceptor': 'tactical',
    };

    const CAT_DISPLAY = {
        'enterprise':  { label: 'Enterprise',    icon: 'ph-buildings',      color: '#8b5cf6' },
        'blue_uas':    { label: 'Blue UAS',      icon: 'ph-shield-check',   color: '#3b82f6' },
        'tactical':    { label: 'Tactical / FPV', icon: 'ph-crosshair',     color: '#ef4444' },
        'isr':         { label: 'ISR',           icon: 'ph-binoculars',     color: '#06b6d4' },
        'loitering':   { label: 'Loitering',     icon: 'ph-timer',          color: '#f59e0b' },
        'fixed_wing':  { label: 'Fixed Wing',    icon: 'ph-airplane-tilt',  color: '#0ea5e9' },
        'ucav':        { label: 'UCAV / MALE',   icon: 'ph-rocket-launch',  color: '#dc2626' },
        'agriculture': { label: 'Agriculture',   icon: 'ph-plant',          color: '#22c55e' },
        'mapping':     { label: 'Mapping',       icon: 'ph-map-trifold',    color: '#0ea5e9' },
        'tethered':    { label: 'Tethered',      icon: 'ph-link-simple',    color: '#64748b' },
        'specialty':   { label: 'Specialty',     icon: 'ph-puzzle-piece',   color: '#059669' },
        'open_source': { label: 'Open Source',   icon: 'ph-git-branch',     color: '#10b981' },
    };

    function normalizeCategory(rawCat) {
        return UNIFIED_CATS[rawCat] || 'specialty';
    }

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        try {
            const [platRes, modelRes] = await Promise.all([
                fetch('/static/intel_platforms.json'),
                fetch('/static/forge_database.json'),
            ]);

            let industryPlatforms = [];
            let droneModels = [];

            if (platRes.ok) industryPlatforms = await platRes.json();
            if (modelRes.ok) {
                const forgeDB = await modelRes.json();
                droneModels = forgeDB.drone_models || forgeDB || [];
            }

            // Normalize ALL drone_models into cards
            const modelNamesLower = new Set();
            const normalizedModels = droneModels
                .filter(m => m.pid && (m.pid.startsWith('MDL-') || m.pid.startsWith('DM-')))
                .map(m => {
                    modelNamesLower.add((m.name || '').toLowerCase());
                    const rawCat = m.build_class || m.category || m.platform_category || '';
                    return {
                        id: m.pid,
                        manufacturer: m.manufacturer || '',
                        manufacturer_hq: m.manufacturer_hq || (m.industry_data && m.industry_data.manufacturer_hq) || '',
                        manufacturer_url: m.manufacturer_url || (m.industry_data && m.industry_data.manufacturer_url) || '',
                        platform_name: m.name || '',
                        category: normalizeCategory(rawCat),
                        _raw_category: rawCat,
                        _source: 'handbook',
                        compliance: {
                            blue_uas: (m.compliance && m.compliance.blue_uas) || m.blue_uas || false,
                            ndaa_compliant: (m.compliance && m.compliance.ndaa_compliant) || m.ndaa_compliant || false,
                            note: (m.compliance && m.compliance.note) || '',
                        },
                        specs: {
                            type: m.vehicle_type || 'quad',
                            flight_time_min: m.max_flight_time_min || null,
                            payload_kg: m.max_payload_kg || null,
                            mtow_kg: m.mtow_kg || null,
                            max_range_km: m.max_range_km || null,
                            max_speed_kmh: m.max_speed_kmh || null,
                            ...(m.industry_data && m.industry_data.specs || {}),
                        },
                        tags: [m.category || '', m.platform_category || '', m.build_class || '', ...(m.tags || [])].filter(Boolean),
                        variants: m.variants || (m.industry_data && m.industry_data.variants) || [],
                        contracts: (m.industry_data && m.industry_data.contracts) || {},
                        production: (m.industry_data && m.industry_data.production) || {},
                        funding: (m.industry_data && m.industry_data.funding) || {},
                        gcs: (m.industry_data && m.industry_data.gcs) || {},
                        image_url: m.image_file || (m.industry_data && m.industry_data.image_url) || '',
                        documentation_availability: (m.industry_data && m.industry_data.documentation_availability) || {},
                        _description: m.description || '',
                        country: m.country || '',
                        combat_proven: m.combat_proven || false,
                        status: m.status || '',
                    };
                });

            // Add industry-only platforms (not already in drone_models)
            const industryDeduped = industryPlatforms
                .filter(p => {
                    const pName = (p.platform_name || '').toLowerCase();
                    return ![...modelNamesLower].some(mn => mn.includes(pName));
                })
                .map(p => ({
                    ...p,
                    category: normalizeCategory(p.category),
                    _raw_category: p.category,
                    _source: 'industry',
                }));

            allPlatforms = [...normalizedModels, ...industryDeduped];
            renderStats();
            buildFilters();
            renderGrid(allPlatforms);
            setupSearch();
            setupModal();
        } catch (e) {
            console.error('[Platforms]', e);
            document.getElementById('plat-grid').innerHTML =
                '<p style="color:var(--text-muted); padding:40px; text-align:center;">Could not load platform data.</p>';
        }
    }

    function renderStats() {
        const countEl = document.getElementById('plat-count');
        const blueEl = document.getElementById('plat-blue-count');
        const ndaaEl = document.getElementById('plat-ndaa-count');
        if (countEl) countEl.textContent = allPlatforms.length;
        if (blueEl) blueEl.textContent = allPlatforms.filter(p => p.compliance?.blue_uas).length;
        if (ndaaEl) ndaaEl.textContent = allPlatforms.filter(p => p.compliance?.ndaa_compliant).length;
    }

    function buildFilters() {
        // Get unique categories that actually have entries
        const activeCats = [...new Set(allPlatforms.map(p => p.category))].sort();
        const bar = document.getElementById('filter-bar');
        if (!bar) return;
        bar.innerHTML = '';

        // All chip
        bar.appendChild(mkChip('All', null, true));

        // Blue UAS chip (special cross-cutting filter)
        const blueCount = allPlatforms.filter(p => p.compliance?.blue_uas).length;
        if (blueCount > 0) bar.appendChild(mkChip(`Blue UAS`, '__blue_uas__'));

        // NDAA chip
        const ndaaCount = allPlatforms.filter(p => p.compliance?.ndaa_compliant).length;
        if (ndaaCount > 0) bar.appendChild(mkChip(`NDAA`, '__ndaa__'));

        // Category chips
        activeCats.forEach(cat => {
            const info = CAT_DISPLAY[cat];
            if (info) bar.appendChild(mkChip(info.label, cat));
        });
    }

    function mkChip(label, value, active = false) {
        const el = document.createElement('button');
        el.className = 'plat-chip' + (active ? ' active' : '');
        el.textContent = label;
        el.addEventListener('click', () => {
            document.querySelectorAll('.plat-chip').forEach(c => c.classList.remove('active'));
            el.classList.add('active');
            activeFilter = value;
            applyFilters();
        });
        return el;
    }

    function setupSearch() {
        const input = document.getElementById('plat-search');
        if (!input) return;
        let timeout;
        input.addEventListener('input', () => {
            clearTimeout(timeout);
            timeout = setTimeout(applyFilters, 200);
        });
    }

    function applyFilters() {
        const query = (document.getElementById('plat-search')?.value || '').toLowerCase().trim();
        let filtered = allPlatforms;

        if (activeFilter === '__blue_uas__') {
            filtered = filtered.filter(p => p.compliance?.blue_uas);
        } else if (activeFilter === '__ndaa__') {
            filtered = filtered.filter(p => p.compliance?.ndaa_compliant);
        } else if (activeFilter) {
            filtered = filtered.filter(p => p.category === activeFilter);
        }

        if (query) {
            filtered = filtered.filter(p => {
                const haystack = [
                    p.manufacturer, p.platform_name, p.category,
                    ...(p.tags || []), ...(p.variants || []),
                    p.compliance?.note || '',
                    p._description || '', p._raw_category || '',
                ].join(' ').toLowerCase();
                return haystack.includes(query);
            });
        }

        renderGrid(filtered);
    }

    function getCatVisual(cat) {
        return CAT_DISPLAY[cat] || { label: cat, icon: 'ph-drone', color: '#22d3ee' };
    }

    function renderGrid(platforms) {
        const grid = document.getElementById('plat-grid');
        if (!grid) return;

        if (platforms.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-muted); padding:40px; text-align:center; grid-column:1/-1;">No platforms match your search.</p>';
            return;
        }

        grid.innerHTML = platforms.map(p => {
            const badges = [];
            if (p.compliance?.blue_uas) badges.push('<span class="plat-badge blue-uas"><i class="ph ph-shield-check"></i> Blue UAS</span>');
            if (p.compliance?.ndaa_compliant) badges.push('<span class="plat-badge ndaa"><i class="ph ph-check-circle"></i> NDAA</span>');

            const vis = getCatVisual(p.category);
            const initials = p.platform_name.split(/[\s-]+/).map(w => w[0]).join('').substring(0, 3).toUpperCase();

            const specs = p.specs || {};
            const specRows = [];
            if (specs.range_km) specRows.push(mkSpec('Range', specs.range_km + ' km'));
            if (specs.speed_kmh) specRows.push(mkSpec('Speed', specs.speed_kmh + ' km/h'));
            if (specs.payload_kg) specRows.push(mkSpec('Payload', specs.payload_kg + ' kg'));
            if (specs.unit_cost_usd_approx) specRows.push(mkSpec('Unit Cost', specs.unit_cost_usd_approx));

            const tags = (p.tags || []).slice(0, 4).map(t => `<span class="plat-tag">${esc(t)}</span>`).join('');

            const hasImage = !!p.image_url;
            const cardVisual = hasImage
                ? `<div class="plat-card-image" style="border-color: ${vis.color};">
                        <img src="${esc(p.image_url)}" alt="${esc(p.platform_name)}" loading="lazy" onerror="this.parentElement.innerHTML='<i class=\\'ph ${vis.icon}\\' style=\\'font-size:48px;color:${vis.color};opacity:0.4;\\'></i>';">
                   </div>`
                : `<div class="plat-card-visual" style="border-color: ${vis.color};">
                        <i class="ph ${vis.icon}" style="color: ${vis.color};"></i>
                        <span class="plat-card-initials" style="color: ${vis.color};">${initials}</span>
                   </div>`;

            return `
                <div class="plat-card" data-id="${esc(p.id)}">
                    ${cardVisual}
                    <div class="plat-card-header">
                        <div>
                            <div class="plat-card-name">${esc(p.platform_name)}</div>
                            <div class="plat-card-mfr">${esc(p.manufacturer)} <span class="plat-card-mfr-hq">${esc(p.manufacturer_hq || '')}</span></div>
                        </div>
                        <div class="plat-card-badges">${badges.join('')}</div>
                    </div>
                    <div class="plat-card-cat">${esc((CAT_DISPLAY[p.category] || {}).label || p.category.replace(/_/g, ' '))}</div>
                    ${specRows.length ? '<div class="plat-card-specs">' + specRows.join('') + '</div>' : ''}
                    ${tags ? '<div class="plat-card-tags">' + tags + '</div>' : ''}
                </div>`;
        }).join('');
    }

    function mkSpec(label, value) {
        return `<div class="plat-spec"><div class="plat-spec-label">${label}</div><div class="plat-spec-value">${esc(String(value))}</div></div>`;
    }

    // ── Detail Modal ──

    function setupModal() {
        const overlay = document.getElementById('plat-modal');
        const closeBtn = document.getElementById('plat-modal-close');
        const content = document.getElementById('plat-modal-content');

        document.getElementById('plat-grid')?.addEventListener('click', (e) => {
            const card = e.target.closest('.plat-card');
            if (!card) return;
            const id = card.dataset.id;
            const platform = allPlatforms.find(p => p.id === id);
            if (!platform) return;
            content.innerHTML = renderDetail(platform);
            overlay.classList.remove('hidden');
        });

        closeBtn?.addEventListener('click', () => overlay.classList.add('hidden'));
        overlay?.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.add('hidden');
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') overlay?.classList.add('hidden');
        });
    }

    function renderDetail(p) {
        const s = p.specs || {};
        const c = p.compliance || {};

        let html = `
            ${p.image_url ? `<div style="width:100%; height:200px; border-radius:12px; overflow:hidden; margin-bottom:20px; background:var(--bg-dark);"><img src="${esc(p.image_url)}" alt="${esc(p.platform_name)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.style.display='none';"></div>` : ''}
            <div class="plat-detail-header">
                <div class="plat-detail-name">${esc(p.platform_name)}</div>
                <div class="plat-detail-mfr">
                    ${esc(p.manufacturer)} · ${esc(p.manufacturer_hq || '')}
                    ${p.manufacturer_url ? ` · <a href="${esc(p.manufacturer_url)}" target="_blank" style="color:var(--accent-red); text-decoration:none;">${esc(p.manufacturer_url)}</a>` : ''}
                </div>
                <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                    ${c.blue_uas ? '<span class="plat-badge blue-uas"><i class="ph ph-shield-check"></i> Blue UAS</span>' : ''}
                    ${c.ndaa_compliant ? '<span class="plat-badge ndaa"><i class="ph ph-check-circle"></i> NDAA</span>' : ''}
                    <span class="plat-card-cat" style="margin:0;">${esc(p.category.replace(/_/g, ' '))}</span>
                </div>
                ${c.note ? `<div style="margin-top:8px; font-size:12px; color:var(--text-muted); font-style:italic;">${esc(c.note)}</div>` : ''}
                ${p.manufacturer_url ? `<a href="${esc(p.manufacturer_url)}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:6px; margin-top:12px; padding:8px 16px; border-radius:6px; background:rgba(34,211,238,0.1); border:1px solid rgba(34,211,238,0.2); color:var(--accent-cyan); font-family:var(--font-family); font-size:12px; font-weight:600; text-decoration:none; letter-spacing:0.03em; transition:all 0.15s;"><i class="ph ph-arrow-square-out"></i> Visit ${esc(p.manufacturer)}</a>` : ''}
            </div>`;

        // Variants
        if (p.variants?.length) {
            html += `<div class="plat-detail-section">
                <div class="plat-detail-section-title"><i class="ph ph-stack"></i> Variants</div>
                <div class="plat-variants-list">${p.variants.map(v => `<span class="plat-variant-chip">${esc(v)}</span>`).join('')}</div>
            </div>`;
        }

        // Specs
        const specPairs = Object.entries(s).filter(([k, v]) => v !== null && v !== undefined && !Array.isArray(v) || (Array.isArray(v) && v.length));
        if (specPairs.length) {
            html += `<div class="plat-detail-section">
                <div class="plat-detail-section-title"><i class="ph ph-gauge"></i> Specifications</div>
                <div class="plat-detail-grid">${specPairs.map(([k, v]) => {
                    const label = k.replace(/_/g, ' ');
                    const val = Array.isArray(v) ? v.join(', ') : String(v);
                    return `<div class="plat-detail-field"><div class="plat-detail-field-label">${esc(label)}</div><div class="plat-detail-field-value">${esc(val)}</div></div>`;
                }).join('')}</div>
            </div>`;
        }

        // GCS
        if (p.gcs && Object.keys(p.gcs).length) {
            html += `<div class="plat-detail-section">
                <div class="plat-detail-section-title"><i class="ph ph-monitor"></i> Ground Control</div>
                <div class="plat-detail-grid">${Object.entries(p.gcs).map(([k, v]) => 
                    `<div class="plat-detail-field"><div class="plat-detail-field-label">${esc(k)}</div><div class="plat-detail-field-value">${esc(v)}</div></div>`
                ).join('')}</div>
            </div>`;
        }

        // Contracts
        if (p.contracts?.length) {
            html += `<div class="plat-detail-section">
                <div class="plat-detail-section-title"><i class="ph ph-handshake"></i> Contracts</div>
                ${p.contracts.map(ct => {
                    const details = [];
                    if (ct.branch) details.push(ct.branch);
                    if (ct.units) details.push(ct.units + ' units');
                    if (ct.value_usd) details.push('$' + (ct.value_usd / 1e6).toFixed(0) + 'M');
                    if (ct.max_value_usd) details.push('up to $' + (ct.max_value_usd / 1e6).toFixed(0) + 'M');
                    if (ct.rank) details.push('Rank #' + ct.rank);
                    if (ct.score) details.push('Score: ' + ct.score);
                    return `<div class="plat-contract-row">
                        <span class="plat-contract-program">${esc(ct.program)}</span>
                        <span class="plat-contract-detail">${esc(details.join(' · '))}</span>
                    </div>`;
                }).join('')}
            </div>`;
        }

        // Funding
        if (p.funding) {
            html += `<div class="plat-detail-section">
                <div class="plat-detail-section-title"><i class="ph ph-currency-circle-dollar"></i> Funding</div>
                <div class="plat-detail-grid">${Object.entries(p.funding).map(([k, v]) => {
                    const label = k.replace(/_/g, ' ');
                    const val = typeof v === 'number' ? '$' + (v / 1e6).toFixed(0) + 'M' : String(v);
                    return `<div class="plat-detail-field"><div class="plat-detail-field-label">${esc(label)}</div><div class="plat-detail-field-value">${esc(val)}</div></div>`;
                }).join('')}</div>
            </div>`;
        }

        // Production
        if (p.production) {
            html += `<div class="plat-detail-section">
                <div class="plat-detail-section-title"><i class="ph ph-factory"></i> Production</div>
                <div class="plat-detail-grid">${Object.entries(p.production).map(([k, v]) => 
                    `<div class="plat-detail-field"><div class="plat-detail-field-label">${esc(k.replace(/_/g, ' '))}</div><div class="plat-detail-field-value">${esc(String(v))}</div></div>`
                ).join('')}</div>
            </div>`;
        }

        // Tags
        if (p.tags?.length) {
            html += `<div class="plat-card-tags" style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border-color);">${p.tags.map(t => `<span class="plat-tag">${esc(t)}</span>`).join('')}</div>`;
        }

        return html;
    }

    function esc(str) {
        const el = document.createElement('span');
        el.textContent = str;
        return el.innerHTML;
    }

})();
