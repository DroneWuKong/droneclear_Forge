// =============================================================
// mission-control.js — Dashboard stats and interactivity
// Standalone IIFE — no dependency on app.js or state.js
//
// Merges drone_models + industry.platforms into one unified
// "Platforms & Models" count, deduplicating overlaps.
// =============================================================

(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', initMissionControl);

    async function initMissionControl() {
        await loadDashboardStats();
    }

    /**
     * Fetch live counts from the static adapter API and populate
     * the stat counter elements. Merges drone_models and industry
     * platforms into a single deduplicated count.
     */
    async function loadDashboardStats() {
        try {
            const [catRes, modelRes, guideRes, platformRes] = await Promise.all([
                fetch('/api/categories/'),
                fetch('/api/drone-models/'),
                fetch('/api/build-guides/'),
                fetch('/api/industry/platforms/'),
            ]);

            // Categories + total component count + build DB grid
            if (catRes.ok) {
                const cats = await catRes.json();
                const catArray = Array.isArray(cats) ? cats : (cats.results || []);

                const catEl = document.getElementById('stat-categories');
                if (catEl) catEl.textContent = catArray.length;

                const totalParts = catArray.reduce((sum, c) => sum + (c.count || 0), 0);
                const partsEl = document.getElementById('stat-parts');
                if (partsEl) partsEl.textContent = totalParts.toLocaleString();

                // Build the clickable parts database grid
                renderDbGrid(catArray);
            }

            // Unified Platforms & Models count
            let models = [];
            let industryPlatforms = [];

            if (modelRes.ok) {
                const data = await modelRes.json();
                models = Array.isArray(data) ? data : (data.results || []);
            }

            if (platformRes && platformRes.ok) {
                const data = await platformRes.json();
                industryPlatforms = Array.isArray(data) ? data : [];
            }

            // Find industry platforms that DON'T already exist in drone_models
            const modelNamesLower = models.map(m => (m.name || '').toLowerCase());
            const industryOnly = industryPlatforms.filter(p => {
                const pName = (p.platform_name || '').toLowerCase();
                const pMfr = (p.manufacturer || '').toLowerCase().split('(')[0].split('/')[0].trim();
                return !modelNamesLower.some(mn =>
                    mn.includes(pName) ||
                    (pMfr && mn.includes(pMfr) && pName.split(' ').some(w => w.length > 3 && mn.includes(w)))
                );
            });

            const totalUnified = models.length + industryOnly.length;
            const modelsEl = document.getElementById('stat-models');
            if (modelsEl) modelsEl.textContent = totalUnified;

            // Build guides
            if (guideRes.ok) {
                const guides = await guideRes.json();
                const guideArray = Array.isArray(guides) ? guides : (guides.results || []);
                const el = document.getElementById('stat-guides');
                if (el) el.textContent = guideArray.length;
            }

        } catch (err) {
            console.warn('Mission Control: could not load stats', err);
        }
    }

    // Category icons for the parts database grid
    const catIcons = {
        antennas: 'ph-broadcast',
        batteries: 'ph-battery-full',
        escs: 'ph-lightning',
        flight_controllers: 'ph-cpu',
        fpv_cameras: 'ph-camera',
        frames: 'ph-frame-corners',
        gps_modules: 'ph-map-pin',
        motors: 'ph-gear-six',
        propellers: 'ph-fan',
        receivers: 'ph-radio',
        stacks: 'ph-stack',
        video_transmitters: 'ph-monitor-play',
    };

    function renderDbGrid(categories) {
        const grid = document.getElementById('mc-db-grid');
        if (!grid) return;

        grid.innerHTML = categories.map(cat => {
            const slug = cat.slug || cat.name?.toLowerCase().replace(/\s+/g, '_') || '';
            const icon = catIcons[slug] || 'ph-cube';
            const label = cat.name || slug.replace(/_/g, ' ');
            const count = cat.count || cat.component_count || 0;

            return `<a href="/builder/?category=${slug}" class="mc-db-card" title="Browse ${count} ${label}">
                <i class="ph ${icon}"></i>
                <div class="mc-db-card-count">${count}</div>
                <div class="mc-db-card-label">${label}</div>
            </a>`;
        }).join('\n');
    }
})();
