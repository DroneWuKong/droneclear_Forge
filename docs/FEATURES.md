# DroneClear Feature Reference

---

## Compatibility Engine (`build.js`)

The compatibility engine validates drone builds in real-time as users add components. It lives in `getBuildWarnings(buildState)` and runs 12 checks that compare field values across selected components.

### How It Works

1. **Each component has a `compatibility` block** inside `schema_data` with key-value pairs the engine reads.
2. **`_compat_hard` / `_compat_soft` arrays** on each component classify which fields are hard constraints (ERROR) vs soft constraints (WARNING). The function `getConstraintSeverity(comp, fieldName)` reads these arrays.
3. **Stack awareness**: If a stack (FC+ESC combo) is selected, the engine extracts its nested `fc` and `esc` sub-objects and uses them as "effective" FC/ESC for all downstream checks.
4. **Null-safe**: Every check silently skips if either value is missing — no false warnings for incomplete data.

### Check Reference

| # | Check | Components | Severity | Fields Compared |
|---|-------|-----------|----------|-----------------|
| 1 | Prop size vs frame max | Frame + Propellers | SOFT | `frame.compat.prop_size_max_in` vs `props.diameter_in` |
| 2 | FC mounting pattern vs frame | Frame + FC | HARD | `frame.compat.fc_mounting_patterns_mm[]` includes `fc.mounting_pattern_mm` |
| 3 | Motor mount spacing vs frame | Frame + Motors | HARD | `frame.compat.motor_mount_hole_spacing_mm` vs `motor.compat.motor_mount_hole_spacing_mm` |
| 4 | Battery cells vs motor max | Battery + Motors | SOFT | `bat.cell_count` vs `motor.compat.cell_count_max` |
| 5 | Battery cells vs ESC range | Battery + ESC | SOFT/HARD | `bat.cell_count` vs `esc.compat.cell_count_min/max` |
| 6 | FC mounting hole size vs frame | Frame + FC | HARD | `frame.fc_mounting_hole_size` vs `fc.compat.mounting_hole_size` |
| 7 | Motor bolt size vs frame | Frame + Motors | HARD | `frame.compat.motor_mount_bolt_size` vs `motor.compat.motor_mount_bolt_size` |
| 8 | ESC mounting pattern vs frame | Frame + ESC | HARD | `frame.compat.fc_mounting_patterns_mm[]` includes `esc.compat.mounting_pattern_mm` |
| 9 | Battery connector vs ESC | Battery + ESC | HARD | `bat.compat.connector_type` vs `esc.compat.battery_connector` |
| 10 | Battery voltage vs ESC range | Battery + ESC | SOFT | `bat.compat.voltage_max_v` vs `esc.compat.voltage_min/max_v` |
| 11 | Camera-VTX video system | VTX + Camera | SOFT | `vtx.video_standard` + `vtx.digital_system` vs camera equivalent |
| 12 | Motor current vs ESC rating | Motors + ESC | SOFT | `motor.compat.min_esc_current_per_motor_a` vs `esc.continuous_current_per_motor_a` |

### Adding a New Check

To add check #13, follow this pattern in `getBuildWarnings()`:

```js
// 13. Your new check description
if (componentA && componentB) {
    const valA = parseFloat(componentA.schema_data?.compatibility?.field_a);
    const valB = parseFloat(componentB.schema_data?.field_b);
    if (valA && valB && /* mismatch condition */) {
        const severity = getConstraintSeverity(componentA, 'field_a');
        warnings.push({
            type: severity,       // 'error' or 'warning'
            title: 'Human-Readable Title',
            message: `Explanation with ${valA} and ${valB} values.`
        });
    }
}
```

Then ensure the relevant `_compat_hard` or `_compat_soft` array in the schema includes the field name so `getConstraintSeverity()` returns the correct level.

### Build Wizard Flow

The wizard (`wizard.js`) guides users through 12 steps in `wizardSequence` (defined in `state.js`):

```
Frames → Stacks (optional) → Flight Controllers → ESCs → Motors → Propellers
→ Video Transmitters → FPV Cameras → Receivers → Batteries
→ Antennas (optional) → Action Cameras (optional)
```

**Stack detection**: If a stack is selected in step 2, steps 3 (FC) and 4 (ESC) are auto-skipped with a toast notification. The wizard confirms before clearing an existing build.

**Wizard highlighting**: During each step, every component in the active category is simulated in the build via `getBuildWarnings()`. Components are highlighted green (compatible), yellow (warnings), or faded (incompatible).

---

## Build Guide (`guide.html`)

Step-by-step guided drone assembly module. After a user creates a parts recipe in the Model Builder, the Build Guide walks them through physical assembly with documentation, photo evidence, and audit trail tracking.

### Core Features

- **Guide Selection Grid**: Browse available build guides as cards showing difficulty, estimated time, step count, and drone class.
- **Build Overview**: Full-width pre-build checklist with required tools, component verification checkboxes, builder name entry, and configurable attribute badges (up to 5 fields per component).
- **Step Runner**: Step-by-step instruction engine with progress tracking, previous/next navigation, and per-step photo capture.
- **Serial Number Tracking**: Every build session receives a unique serial number (`DC-YYYYMMDD-XXXX`), generated server-side.
- **Photo Capture**: Camera integration via `navigator.mediaDevices.getUserMedia()` (rear camera preferred) with file upload fallback. Photos captured client-side via camera API.
- **Safety Warnings**: Amber-highlighted warning boxes on steps involving soldering, high voltage, or other hazards.
- **Betaflight CLI Viewer**: Dark terminal-styled code block for firmware configuration steps, with one-click copy.
- **3D STL Viewer**: Three.js-powered 3D model viewer for 3D-printed parts. Auto-centres and scales, orbit controls.
- **Media Carousel**: Multi-image/video carousel per step with CSS `translateX` sliding, dot indicators, prev/next arrows, and caption bar. Supports YouTube, Vimeo (auto-converted to embed URLs), and direct image/video URLs.
- **Lightbox Viewer**: Full-screen media viewer (95vw/95vh) with dark backdrop blur, keyboard navigation (Arrow keys, Escape).
- **Build Timer**: Dual stopwatch showing total build elapsed time and per-step elapsed time.
- **Step Notes**: Per-step note-taking textarea with auto-save (debounced 1s).
- **Markdown & Checklists**: Step descriptions support markdown-style checklists (`- [ ] item`).

### Build Session Lifecycle

```
Selection → Overview (checklist) → Start Build → Step 1..N (photos at each) → Complete → Summary
```

Each session records: serial number, guide reference, builder name, start/completion timestamps, current step, status, component checklist state, per-step notes, and all captured photos.

### Guide Editor

The guide editor (`/guide/` → Edit mode) provides a dedicated authoring interface:

1. **Guide List** (sidebar panel): All existing guides with PID and step count.
2. **Guide Metadata Form** (full-width): PID, name, difficulty, drone class, estimated time, thumbnail URL, description, required tools.
3. **Steps Manager**: Ordered list with **drag-and-drop reordering** (grab handle + drop indicators), "+ Add Step" button, remove button per step. Dragging splices the array and renumbers `order` fields automatically.
4. **Step Detail Form** (collapsible): Clickable header with animated chevron. Contains: title, type, time, description, safety warning, **media list editor** (add/remove rows of type/URL/caption), STL URL, Betaflight CLI, required component PIDs.
5. **Checklist Display Fields Picker**: 2-column checkbox grid of 13 available attributes. Max 5 enforced.
6. **Actions**: Delete (muted, left), Preview (outline), Save Guide (prominent red primary, right).

### Runner Layout

```
┌─────────────────────────────────────────┐
│ Progress Bar (full width)               │
├─────────────────────────────────────────┤
│ Step Header (number, type, timer)       │
│ Step Title                              │
│ Safety Warning (if present)             │
│ Step Description (markdown/checklists)  │
│ Media Carousel (if media attached)      │
│ STL Viewer / CLI Block (if applicable)  │
├────────────────────┬────────────────────┤
│ Photo Gallery      │ Step Notes         │
│ (camera capture)   │ (auto-save)        │
├────────────────────┴────────────────────┤
│ [Prev 15%] [  Step X of N  ] [Next 15%]│
└─────────────────────────────────────────┘
```

### Seed Data

```bash
python manage.py seed_guides
```

Seeds a **10-step "5-inch Freestyle Quad Build"** guide with safety warnings, Betaflight CLI dump, and multi-media test data.

---

## Build Audit (`audit.html`)

Enterprise-grade build audit viewer. When a build is started, all guide steps and component specs are frozen into immutable snapshots. Every action during the build is logged as an append-only `BuildEvent`. Photos are SHA-256 hashed server-side.

### Core Features

- **Serial Number Lookup**: Search by serial number (`DC-YYYYMMDD-NNNN`) or browse recent completed builds.
- **Deep-link Support**: `/audit/#DC-20260306-0001` auto-loads the record.
- **Audit Header**: Serial number, status badge, builder name, timestamps, duration, photo count.
- **Event Timeline**: Chronological feed of all build events with color-coded icons.
- **Step Accordion**: Expandable panels per step showing description, timing vs estimate, notes, photos with SHA-256 badges, components used.
- **Component BOM**: Full bill of materials (name, PID, category, manufacturer, price, weight).
- **Data Integrity Panel**: Five verification checks — guide snapshot, component snapshot, photo hashes, event log, build status — each with pass/warn badges.

### Event Emission

Frontend `emitBuildEvent()` queues events (500ms debounce), `flushEventQueue()` sends to `/api/build-sessions/{sn}/events/`. `beforeunload` handler uses `navigator.sendBeacon()` for page-close safety.

---

## Parts Import Workflow

Parts can be bulk-imported via structured JSON format. This enables an LLM-assisted workflow where users can scrape product pages and format the output for import.

- **Import file format**: `DroneClear Components Visualizer/parts_import_template.json`
- **LLM-assisted import guide**: `DroneClear Components Visualizer/llm_parts_import_guide.md`
- **In-app**: Parts Library Editor → "Import Parts" button → Upload JSON tab

The import endpoint (`POST /api/import/parts/`) performs upsert by PID and returns: `{ created, updated, errors }`.

---

## UI Standards

### Sidebar Navigation
- Use `.logo-text` gradient class for the logo area
- System versioning and settings in `<details class="system-meta-drawer">` accordion
- Maintenance buttons (Restart, Bug Report) nested inside the meta drawer
- Five menu items on all pages: Master Attributes → Parts Library Editor → Model Builder → Build Guide → Build Audit
- Active page highlighted with `.btn-menu.active` class

### Topbar Navigation

All pages use this flexbox structure:

```html
<header class="topbar">
    <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
        <div style="display: flex; align-items: center; gap: 12px;">
            <button class="mobile-nav-toggle" id="mobile-nav-toggle" style="display:none;">
                <i class="ph ph-list" style="font-size:28px;"></i>
            </button>
            <h1 class="page-title">Page Title</h1>
        </div>
        <div style="display: flex; align-items: center; gap: 16px;">
            <!-- Page-specific tools here -->
            <div style="width: 1px; height: 24px; background: var(--border-color); margin: 0 8px;"></div>
            <button class="dark-mode-toggle" id="dark-mode-toggle">
                <i class="ph ph-moon" id="dark-mode-icon"></i>
            </button>
            <button class="dark-mode-toggle" id="shortcuts-help-btn">
                <i class="ph ph-keyboard"></i>
            </button>
        </div>
    </div>
</header>
```

### Dark Mode
- Applied via `[data-theme="dark"]` on `<html>`
- True black palette: `--bg-dark: #000000`, `--bg-panel: #0a0a0a`
- Persisted to `localStorage` key `dc-theme`

### Toast Notifications
- Call `showToast(message, type)` from `utils.js` (loaded on all pages)
- Types: `'success'`, `'error'`, `'warning'`, `'info'`
- Self-dismisses after 3.5 seconds
