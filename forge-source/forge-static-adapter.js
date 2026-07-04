/**
 * Forge Static Adapter
 * Intercepts Django API calls and serves data from forge_database.json + drone_parts_schema_v3.json.
 * Drop-in replacement for the Django backend — no server needed.
 * 
 * Supports: categories, components, schema, drone-models, build-guides
 * Saves/loads builds to localStorage instead of the API.
 */

(function () {
    'use strict';

    // Global HTML-escape helper — pipeline/scraped data must pass through this
    // before being interpolated into innerHTML anywhere on the site.
    window.escHTML = window.escHTML || function (s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    };

    let _db = null;
    let _schema = null;
    let _ready = null; // Promise that resolves when data is loaded
    const COMPONENT_PATCH_KEY = 'forge-component-patch-v1';

    // ── Load static data on page load ──
    async function _loadDB() {
        const cb = '?v=' + Date.now();
        const paths = ['/static/forge_database.json', '../static/forge_database.json', 'forge_database.json'];
        let db = null;
        for (const p of paths) {
            try {
                const ctrl = new AbortController();
                const tid = setTimeout(() => ctrl.abort(), 15000);
                const r = await fetch(p + cb, { cache: 'no-store', signal: ctrl.signal });
                clearTimeout(tid);
                if (r.ok) { db = await r.json(); break; }
            } catch(e) {}
        }
        if (!db) throw new Error('forge_database.json not found at any path');
        return db;
    }

    _ready = window.__forgeAdapterReady = _loadDB().then(db => {
        _db = db;
        _schema = db;
        if (typeof schemaData !== 'undefined' && _db.components) {
            Object.assign(schemaData, _db.components);
        }
        console.log(`[Forge] Adapter loaded: ${Object.values(_db.components).reduce((a,b)=>a+b.length,0)} parts`);
    }).catch(e => {
        console.error('[Forge] Adapter failed to load DB:', e);
        // Don't reject — let fetchAllCategories try its own paths
    });

    // ── Build synthetic category list from the database keys ──
    function readComponentPatch() {
        try {
            const raw = localStorage.getItem(COMPONENT_PATCH_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed && parsed.items && parsed.deleted) return parsed;
        } catch (e) {}
        return { items: {}, deleted: {} };
    }

    function writeComponentPatch(patch) {
        localStorage.setItem(COMPONENT_PATCH_KEY, JSON.stringify(patch));
    }

    function normalizeComponentRecord(record) {
        const schema = record.schema_data || record;
        return {
            pid: record.pid,
            name: record.name || '',
            category: record.category || '',
            manufacturer: record.manufacturer || '',
            description: record.description || '',
            link: record.link || '',
            image_file: record.image_file || '',
            manual_link: record.manual_link || '',
            approx_price: record.approx_price || null,
            schema_data: schema,
        };
    }

    function exportComponentRecord(record) {
        return {
            ...record.schema_data,
            pid: record.pid,
            name: record.name,
            manufacturer: record.manufacturer,
            description: record.description,
            link: record.link,
            image_file: record.image_file,
            manual_link: record.manual_link,
            approx_price: record.approx_price,
            category: record.category,
        };
    }

    function getMergedComponentsByCategory() {
        const patch = readComponentPatch();
        const categories = {};

        Object.keys(_db.components).forEach(cat => {
            categories[cat] = (_db.components[cat] || []).map(part => normalizeComponentRecord({
                pid: part.pid,
                name: part.name,
                category: cat,
                manufacturer: part.manufacturer || '',
                description: part.description || '',
                link: part.link || '',
                image_file: part.image_file || '',
                manual_link: part.manual_link || '',
                approx_price: part.approx_price || null,
                schema_data: part,
            }));
        });

        Object.entries(patch.items).forEach(([pid, item]) => {
            if (patch.deleted[pid]) return;
            const cat = item.category;
            if (!categories[cat]) categories[cat] = [];
            const idx = categories[cat].findIndex(entry => entry.pid === pid);
            if (idx >= 0) categories[cat][idx] = normalizeComponentRecord(item);
            else categories[cat].push(normalizeComponentRecord(item));
        });

        Object.keys(patch.deleted).forEach(pid => {
            Object.keys(categories).forEach(cat => {
                categories[cat] = categories[cat].filter(item => item.pid !== pid);
            });
        });

        return categories;
    }

    function getAllComponents() {
        return Object.values(getMergedComponentsByCategory()).flat();
    }

    function getComponentByPid(pid) {
        return getAllComponents().find(item => item.pid === pid) || null;
    }

    function saveComponent(record) {
        const patch = readComponentPatch();
        const normalized = normalizeComponentRecord(record);
        patch.items[normalized.pid] = normalized;
        delete patch.deleted[normalized.pid];
        writeComponentPatch(patch);
        return normalized;
    }

    function removeComponent(pid) {
        const patch = readComponentPatch();
        delete patch.items[pid];
        patch.deleted[pid] = true;
        writeComponentPatch(patch);
    }

    function importComponents(records) {
        const patch = readComponentPatch();
        let created = 0;
        let updated = 0;
        const errors = [];

        records.forEach((raw, index) => {
            const pid = (raw.pid || '').toString().trim();
            const category = (raw.category || '').toString().trim();
            const name = (raw.name || '').toString().trim();
            if (!pid || !category || !name) {
                errors.push({ index, pid, error: 'missing pid/category/name' });
                return;
            }

            const existing = getComponentByPid(pid);
            patch.items[pid] = normalizeComponentRecord({
                pid,
                category,
                name,
                manufacturer: raw.manufacturer || '',
                description: raw.description || '',
                link: raw.link || '',
                image_file: raw.image_file || '',
                manual_link: raw.manual_link || '',
                approx_price: raw.approx_price || raw.price_usd || null,
                schema_data: raw.schema_data || raw,
            });
            delete patch.deleted[pid];
            if (existing) updated += 1;
            else created += 1;
        });

        writeComponentPatch(patch);
        return { created, updated, errors };
    }

    function getCategories() {
        const merged = getMergedComponentsByCategory();
        const catNames = {
            antennas: 'Antennas',
            batteries: 'Batteries',
            escs: 'ESCs',
            flight_controllers: 'Flight Controllers',
            fpv_cameras: 'FPV Cameras',
            frames: 'Frames',
            gps_modules: 'GPS Modules',
            motors: 'Motors',
            propellers: 'Propellers',
            receivers: 'Receivers',
            stacks: 'Stacks',
            video_transmitters: 'Video Transmitters',
            integrated_stacks: 'Integrated FC + Compute',
            fpv_detectors: 'FPV Detectors',
            payload_droppers: 'Payload Droppers',
            video_scramblers: 'Video Scramblers',
            control_link_tx: 'Control Link TX',
        };
        return Object.keys(merged).map((slug, i) => ({
            id: i + 1,
            name: catNames[slug] || slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            slug: slug,
            component_count: merged[slug].length,
            count: merged[slug].length,
        }));
    }

    // ── Build synthetic component list matching DRF serializer shape ──
    function getComponents(category) {
        const merged = getMergedComponentsByCategory();
        return (merged[category] || []).map(normalizeComponentRecord);
    }

    // ── Drone models — save/load from localStorage ──
    const MODELS_KEY = 'forge-drone-models';

    function getDroneModels() {
        const saved = localStorage.getItem(MODELS_KEY);
        if (saved) {
            try { return JSON.parse(saved); } catch (e) { /* fall through */ }
        }
        return _db.drone_models || [];
    }

    function saveDroneModel(model) {
        const models = getDroneModels();
        const idx = models.findIndex(m => m.pid === model.pid);
        if (idx >= 0) {
            models[idx] = model;
        } else {
            models.push(model);
        }
        localStorage.setItem(MODELS_KEY, JSON.stringify(models));
        return model;
    }

    function deleteDroneModel(pid) {
        const models = getDroneModels().filter(m => m.pid !== pid);
        localStorage.setItem(MODELS_KEY, JSON.stringify(models));
    }

    // ── Intercept fetch ──
    const _originalFetch = window.fetch;

    window.fetch = async function (url, options) {
        // Only intercept our API paths — but NOT /api/data (handled by CF Pages Functions)
        if (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/data')) {
            await _ready;
            return handleApiCall(url, options || {});
        }
        // Pass through /api/data and everything else
        return _originalFetch.apply(this, arguments);
    };

    function jsonResponse(data, status = 200) {
        return new Response(JSON.stringify(data), {
            status: status,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    function handleApiCall(url, options) {
        const method = (options.method || 'GET').toUpperCase();
        const path = url.split('?')[0].replace(/\/$/, '');
        const params = new URLSearchParams(url.includes('?') ? url.split('?')[1] : '');

        // GET /api/categories/
        if (path === '/api/categories' && method === 'GET') {
            return jsonResponse(getCategories());
        }

        // GET /api/components/?category=xxx
        if (path === '/api/components' && method === 'GET') {
            const cat = params.get('category');
            if (cat) {
                return jsonResponse(getComponents(cat));
            }
            // ?pids=PID1,PID2
            const pids = params.get('pids');
            if (pids) {
                const pidList = pids.split(',');
                const results = [];
                for (const [cat, parts] of Object.entries(_db.components)) {
                    for (const p of parts) {
                        if (pidList.includes(p.pid)) {
                            results.push({
                                pid: p.pid, name: p.name, category: cat,
                                manufacturer: p.manufacturer || '',
                                description: p.description || '',
                                link: p.link || '', image_file: p.image_file || '',
                                approx_price: p.approx_price || null,
                                schema_data: p,
                            });
                        }
                    }
                }
                return jsonResponse(results);
            }
            // All components
            return jsonResponse(getAllComponents());
        }

        if (path === '/api/components' && method === 'POST') {
            const body = JSON.parse(options.body);
            return jsonResponse(saveComponent(body), 201);
        }

        const componentMatch = path.match(/^\/api\/components\/(.+)$/);
        if (componentMatch) {
            const pid = componentMatch[1];
            if (method === 'GET') {
                const component = getComponentByPid(pid);
                return component ? jsonResponse(component) : jsonResponse({ detail: 'Not found' }, 404);
            }
            if (method === 'PUT') {
                const body = JSON.parse(options.body);
                body.pid = pid;
                return jsonResponse(saveComponent(body));
            }
            if (method === 'DELETE') {
                removeComponent(pid);
                return new Response(null, { status: 204 });
            }
        }

        // GET /api/schema/
        if (path === '/api/schema' && method === 'GET') {
            return jsonResponse(_schema);
        }

        // GET /api/drone-models/
        if (path === '/api/drone-models' && method === 'GET') {
            return jsonResponse(getDroneModels());
        }

        // POST /api/drone-models/
        if (path === '/api/drone-models' && method === 'POST') {
            const body = JSON.parse(options.body);
            const model = saveDroneModel(body);
            return jsonResponse(model, 201);
        }

        // GET/PUT/DELETE /api/drone-models/{pid}/
        const modelMatch = path.match(/^\/api\/drone-models\/(.+)$/);
        if (modelMatch) {
            const pid = modelMatch[1];
            if (method === 'GET') {
                const model = getDroneModels().find(m => m.pid === pid);
                return model ? jsonResponse(model) : jsonResponse({ detail: 'Not found' }, 404);
            }
            if (method === 'PUT') {
                const body = JSON.parse(options.body);
                body.pid = pid;
                return jsonResponse(saveDroneModel(body));
            }
            if (method === 'DELETE') {
                deleteDroneModel(pid);
                return jsonResponse(null, 204);
            }
        }

        // GET /api/build-guides/
        if (path === '/api/build-guides' && method === 'GET') {
            return jsonResponse(_db.build_guides || []);
        }

        if (path === '/api/export/parts' && method === 'GET') {
            const cat = params.get('category');
            const items = cat ? getComponents(cat) : getAllComponents();
            return jsonResponse(items.map(exportComponentRecord));
        }

        if (path === '/api/import/parts' && method === 'POST') {
            const body = JSON.parse(options.body);
            if (!Array.isArray(body)) return jsonResponse({ error: 'Expected an array of parts' }, 400);
            return jsonResponse(importComponents(body));
        }

        // GET /api/build-sessions/ — return empty (no server-side sessions in static mode)
        if (path === '/api/build-sessions' && method === 'GET') {
            return jsonResponse([]);
        }

        // ── Industry Data Endpoints ──

        // GET /api/industry/
        if (path === '/api/industry' && method === 'GET') {
            return jsonResponse(_db.industry || {});
        }

        // GET /api/industry/platforms/
        if (path === '/api/industry/platforms' && method === 'GET') {
            return jsonResponse((_db.industry && _db.industry.platforms) || []);
        }

        // GET /api/industry/programs/
        if (path === '/api/industry/programs' && method === 'GET') {
            return jsonResponse((_db.industry && _db.industry.key_programs) || []);
        }

        // GET /api/industry/compliance/
        if (path === '/api/industry/compliance' && method === 'GET') {
            return jsonResponse((_db.industry && _db.industry.compliance_tiers) || {});
        }

        // Fallback: return empty for any unhandled API call
        console.warn(`[Forge] Unhandled API call: ${method} ${url}`);
        return jsonResponse({ detail: `Unhandled API call: ${method} ${path}` }, 501);
    }

})();
