# DroneClear Configurator

The DroneClear Configurator is a robust internal tool built to manage, visualize, and construct drone component databases. It allows administrators to define a master schema of drone parts, populate a live library of components based on that schema, and provides a "Model Builder" interface to assemble virtual drone builds logically.

> **Purpose**: This is a **data-prep and configuration tool** whose output feeds the production DroneClear compatibility engine. The engine powers end-user features including parts ordering, audit trails, airworthiness checks, and cybersecurity verification. Data quality here directly affects production quality.

---

## Pages

| Page | URL | Description |
|------|-----|-------------|
| **Master Attributes Editor** | `/template/` | Define categories and attributes, manage the v3 schema blueprint |
| **Parts Library Editor** | `/library/` | CRUD for components, bulk import/export, deep-link editing |
| **Model Builder** | `/` | Browse parts, 12-step build wizard, real-time compatibility validation (12 checks) |
| **Build Guide** | `/guide/` | Step-by-step assembly with photo capture, media carousel, guide authoring editor |
| **Build Audit** | `/audit/` | Immutable event log, SHA-256 photo hashing, serial lookup, integrity verification |

---

## Quick Start

1. **Clone the Repository**
   ```bash
   git clone https://github.com/tedstrazimiri/droneclear.git
   cd droneclear
   ```

2. **Backend Setup**
   ```bash
   python -m venv venv
   .\venv\Scripts\activate   # Windows
   # source venv/bin/activate  # Mac/Linux
   pip install -r requirements.txt
   ```

3. **Run Migrations**
   ```bash
   python manage.py migrate
   ```

4. **Seed Sample Data** (optional — creates a sample build guide for testing)
   ```bash
   python manage.py seed_guides
   ```

5. **Run the Application**
   ```bash
   python manage.py runserver 8000
   ```
   Navigate to `http://127.0.0.1:8000/`

6. **Reset Parts Library to Golden State** (wipes all parts, seeds from schema examples)
   ```bash
   python manage.py reset_to_golden
   ```

---

## Tech Stack

- **Backend**: Django 5 + Django REST Framework, SQLite
- **Frontend**: Vanilla JS (no framework), CodeMirror 6, Three.js, Phosphor Icons
- **Deployment**: PythonAnywhere — see [DEPLOY_PYTHONANYWHERE.md](DEPLOY_PYTHONANYWHERE.md)

---

## Documentation

| Document | Contents |
|----------|----------|
| [Architecture](docs/ARCHITECTURE.md) | Frontend modules, CSS files, backend structure, API endpoints, schema format, test coverage |
| [Django Models](docs/MODELS.md) | All 8 model field reference tables |
| [Features](docs/FEATURES.md) | Compatibility engine, build guide, build audit, parts import, UI standards |
| [Deployment](DEPLOY_PYTHONANYWHERE.md) | PythonAnywhere setup, configuration, and updates |
| [Backlog](BACKLOG.md) | All tracked issues, bugs, and feature requests (single source of truth) |
| [Changelog](CHANGELOG.md) | Session-by-session development history |

---

## Multi-Agent Development

This repo is developed collaboratively by two AI agents:
- **Claude** works in: `DRONECLEAR - Claude` (and git worktrees)
- **Gemini** works in: `DRONECLEAR - Claude - Gemini`

See [CLAUDE.md](CLAUDE.md) for session protocols, conventions, and the `/close-session` workflow.
