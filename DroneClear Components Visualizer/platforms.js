(function () {
    'use strict';

    let allPlatforms = [];
    let activeFilter = null;

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        try {
            const res = await fetch('/api/industry/platforms/');
            if (!res.ok) throw new Error('Failed to load platforms');
            allPlatforms = await res.json();
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
        const cats = [...new Set(allPlatforms.map(p => p.category))].sort();
        const bar = document.getElementById('filter-bar');
        if (!bar) return;

        // All chip
        const allChip = mkChip('All', null, true);
        bar.appendChild(allChip);

        // Blue UAS chip
        const blueChip = mkChip('Blue UAS', '__blue_uas__');
        bar.appendChild(blueChip);

        // Category chips (simplified labels)
        const catLabels = {
            fpv_strike: 'FPV Strike',
            fpv_strike_fiber: 'Fiber',
            fpv_isr: 'FPV ISR',
            fpv_isr_dev: 'ISR Dev',
            fpv_indoor_recon: 'Indoor',
            fpv: 'FPV',
            fpv_strike_and_tactical: 'FPV Tactical',
            loitering_munition: 'Loitering',
            tactical_isr: 'Tactical ISR',
            nano_isr: 'Nano ISR',
            heavy_lift_multi_mission: 'Heavy Lift',
            fixed_wing_isr: 'Fixed Wing',
            autonomous_interceptor: 'Interceptor',
            tethered_persistent: 'Tethered',
            group3_vtol_isr: 'Group 3 VTOL',
            evtol_fixed_wing_isr: 'eVTOL',
            modular_multi_mission: 'Modular',
        };

        cats.forEach(cat => {
            const label = catLabels[cat] || cat.replace(/_/g, ' ');
            bar.appendChild(mkChip(label, cat));
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
        } else if (activeFilter) {
            filtered = filtered.filter(p => p.category === activeFilter);
        }

        if (query) {
            filtered = filtered.filter(p => {
                const haystack = [
                    p.manufacturer, p.platform_name, p.category,
                    ...(p.tags || []), ...(p.variants || []),
                    p.compliance?.note || '',
                ].join(' ').toLowerCase();
                return haystack.includes(query);
            });
        }

        renderGrid(filtered);
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

            const specs = p.specs || {};
            const specRows = [];
            if (specs.range_km) specRows.push(mkSpec('Range', specs.range_km + ' km'));
            if (specs.speed_kmh) specRows.push(mkSpec('Speed', specs.speed_kmh + ' km/h'));
            if (specs.payload_kg) specRows.push(mkSpec('Payload', specs.payload_kg + ' kg'));
            if (specs.unit_cost_usd_approx) specRows.push(mkSpec('Unit Cost', specs.unit_cost_usd_approx));
            if (specs.type) specRows.push(mkSpec('Type', specs.type));
            if (specs.prop_size_inches) specRows.push(mkSpec('Props', Array.isArray(specs.prop_size_inches) ? specs.prop_size_inches.join(', ') + '"' : specs.prop_size_inches + '"'));

            const tags = (p.tags || []).map(t => `<span class="plat-tag">${esc(t)}</span>`).join('');

            return `
                <div class="plat-card" data-id="${esc(p.id)}">
                    <div class="plat-card-header">
                        <div>
                            <div class="plat-card-name">${esc(p.platform_name)}</div>
                            <div class="plat-card-mfr">${esc(p.manufacturer)} <span class="plat-card-mfr-hq">${esc(p.manufacturer_hq || '')}</span></div>
                        </div>
                        <div class="plat-card-badges">${badges.join('')}</div>
                    </div>
                    <div class="plat-card-cat">${esc(p.category.replace(/_/g, ' '))}</div>
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
