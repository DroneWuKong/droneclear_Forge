# DroneClear Django Models

All models live in `components/models.py`.

---

## Category

Drone part categories (e.g., Motors, ESCs, Frames). Created from the master schema.

| Field | Type | Notes |
|-------|------|-------|
| `name` | `CharField(100)` | Display name |
| `slug` | `SlugField(100, unique)` | URL-safe key, e.g. `flight_controllers` |

---

## Component

Individual drone parts. Each belongs to a category and stores its full spec sheet in `schema_data`.

| Field | Type | Notes |
|-------|------|-------|
| `pid` | `CharField(50, unique)` | Part ID, e.g. `MTR-0001` |
| `name` | `CharField(255)` | Display name |
| `category` | `FK → Category` | Parent category |
| `schema_data` | `JSONField(default=dict)` | Full spec sheet matching the master schema |

---

## DroneModel

A saved drone build — a named collection of component references.

| Field | Type | Notes |
|-------|------|-------|
| `pid` | `CharField(50, unique)` | e.g. `DM-5IN-FREE-01` |
| `name` | `CharField(255)` | Display name |
| `description` | `TextField` | Build description |
| `relations` | `JSONField(default=dict)` | `{ "motors": "MTR-0001", "frame": "FRM-0003", ... }` |

---

## BuildGuide

Top-level guide definition. References an optional `DroneModel` for linking to a saved parts recipe.

| Field | Type | Notes |
|-------|------|-------|
| `pid` | `CharField(50, unique)` | e.g. `BG-5IN-FREE-01` |
| `name` | `CharField(255)` | Display name |
| `description` | `TextField` | Rich description |
| `difficulty` | `CharField` | `beginner` / `intermediate` / `advanced` |
| `estimated_time_minutes` | `IntegerField` | Total build time estimate |
| `drone_class` | `CharField(50)` | e.g. `5inch`, `3inch_cinewhoop` |
| `thumbnail` | `CharField(500)` | URL for card thumbnail |
| `drone_model` | `FK → DroneModel` | Optional link to saved build |
| `required_tools` | `JSONField(list)` | e.g. `["Soldering iron", "Hex drivers"]` |
| `settings` | `JSONField(dict)` | Extensible settings (e.g. `{ "checklist_fields": ["manufacturer", "weight", "step_reference"] }`) |

---

## BuildGuideStep

Ordered steps within a guide. Each step has a type that controls which UI elements are shown.

| Field | Type | Notes |
|-------|------|-------|
| `guide` | `FK → BuildGuide` | Parent guide |
| `order` | `IntegerField` | Step sequence (unique per guide) |
| `title` | `CharField(255)` | Step title |
| `description` | `TextField` | Assembly instructions (supports markdown + checklists) |
| `safety_warning` | `TextField` | Displayed in amber warning box |
| `media` | `JSONField(list)` | Media array: `[{type, url, caption}]` |
| `stl_file` | `CharField(500)` | URL to STL for 3D viewer |
| `betaflight_cli` | `TextField` | CLI dump for firmware steps |
| `step_type` | `CharField` | `assembly` / `soldering` / `firmware` / `3d_print` / `inspection` |
| `estimated_time_minutes` | `IntegerField` | Per-step time estimate |
| `required_components` | `JSONField(list)` | Component PIDs needed, e.g. `["MTR-0001"]` |

---

## BuildSession

Tracks an individual build attempt. Serial number is auto-generated server-side.

| Field | Type | Notes |
|-------|------|-------|
| `serial_number` | `CharField(50, unique)` | Format: `DC-YYYYMMDD-XXXX` |
| `guide` | `FK → BuildGuide` | Which guide is being followed |
| `started_at` | `DateTimeField(auto)` | Session start |
| `completed_at` | `DateTimeField(null)` | Set on completion |
| `current_step` | `IntegerField` | Last active step index |
| `status` | `CharField` | `in_progress` / `completed` / `abandoned` |
| `notes` | `TextField` | Builder notes |
| `step_notes` | `JSONField(dict)` | Per-step notes: `{ "1": "note text", ... }` |
| `component_checklist` | `JSONField(dict)` | `{ "MTR-0001": true, ... }` |
| `builder_name` | `CharField(255)` | Who performed the build |
| `guide_snapshot` | `JSONField(dict)` | Frozen guide + steps at build start (audit) |
| `component_snapshot` | `JSONField(dict)` | Frozen component specs at build start (audit) |
| `step_timing` | `JSONField(dict)` | Per-step elapsed time: `{ "1": 12345, ... }` |

---

## StepPhoto

Photos captured during a build session, linked to specific steps. Used for audit trail and CV dataset collection.

| Field | Type | Notes |
|-------|------|-------|
| `session` | `FK → BuildSession` | Parent session |
| `step` | `FK → BuildGuideStep` | Which step this photo documents |
| `image` | `ImageField` | Stored in `media/build_photos/YYYY/MM/DD/` |
| `captured_at` | `DateTimeField(auto)` | Timestamp |
| `notes` | `TextField` | Optional photo annotation |
| `sha256` | `CharField(64)` | SHA-256 hash for integrity verification |

---

## BuildEvent

Immutable audit log entries. Append-only — no update or delete via API.

| Field | Type | Notes |
|-------|------|-------|
| `session` | `FK → BuildSession` | Parent session |
| `event_type` | `CharField(30)` | `session_started` / `session_completed` / `session_abandoned` / `step_started` / `step_completed` / `photo_captured` / `note_saved` / `checklist_updated` |
| `timestamp` | `DateTimeField(auto)` | Server-side, prevents backdating |
| `step_order` | `IntegerField(null)` | Which step (null for session-level events) |
| `data` | `JSONField(dict)` | Event-specific payload |
