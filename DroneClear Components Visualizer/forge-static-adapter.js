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

    let _db = null;
    let _schema = null;
    let _ready = null; // Promise that resolves when data is loaded

    // ── Load static data on page load ──
    _ready = Promise.all([
        fetch('/static/forge_database.json').then(r => r.json()),
        fetch('/static/drone_parts_schema_v3.json').then(r => r.json()),
    ]).then(([db, schema]) => {
        _db = db;
        _schema = schema;
        console.log(`[Forge] Static DB loaded: ${Object.values(_db.components).reduce((a, b) => a + b.length, 0)} parts`);
    });

    // ── Build synthetic category list from the database keys ──
    function getCategories() {
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
        };
        return Object.keys(_db.components).map((slug, i) => ({
            id: i + 1,
            name: catNames[slug] || slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            slug: slug,
            component_count: _db.components[slug].length,
            count: _db.components[slug].length,
        }));
    }

    // ── Build synthetic component list matching DRF serializer shape ──
    function getComponents(category) {
        const parts = _db.components[category] || [];
        return parts.map(p => ({
            pid: p.pid,
            name: p.name,
            category: category,
            manufacturer: p.manufacturer || '',
            description: p.description || '',
            link: p.link || '',
            image_file: p.image_file || '',
            approx_price: p.approx_price || null,
            schema_data: p, // The full part object IS the schema data
        }));
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
        // Only intercept our API paths
        if (typeof url === 'string' && url.startsWith('/api/')) {
            await _ready;
            return handleApiCall(url, options || {});
        }
        // Pass through everything else (CDN scripts, fonts, etc.)
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
            const all = [];
            for (const cat of Object.keys(_db.components)) {
                all.push(...getComponents(cat));
            }
            return jsonResponse(all);
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
        return jsonResponse([], 200);
    }

})();
