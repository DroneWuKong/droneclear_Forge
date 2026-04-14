# Archive — Historical Artifacts

**⚠ None of these files are referenced by the live build. Do not import,
invoke, or rely on them in new code. They exist as a historical record.**

DroneClear Forge is a static site — no backend, no Django. See
`../README.md` and `../CLAUDE.md` for the current architecture. This
directory predates the current schema and exists only so the commit
history can point at "what we used to do" without blocking a `git log`
search.

## What's in here

| File | What it was |
|---|---|
| `Drone Parts 1 - Olympic Bear Build.csv` | Early spreadsheet export, pre-JSON schema |
| `Drone Parts 2 .csv` | Another early spreadsheet |
| `Drone Parts List 3 - Big List .csv` | Pre-migration "big list" parts export |
| `convert_csv_to_json.py` | One-time CSV → JSON migration script, already run |
| `settings_legacy_flat.py` | Old Django `settings.py` from before Django was removed |
| `drone_database.json` | Pre-v3 database snapshot |
| `drone_database_exported_v2.json` | v2 export snapshot |
| `SPRINT_REPORT_v3_schema.md` | Write-up of the v3 schema overhaul |
| `v3_schema_overhaul_plan.md` | The plan that preceded the v3 overhaul |

## If you're a new contributor

- **Looking for the live database?** `DroneClear Components Visualizer/forge_database.json` in the repo root — that's the canonical product DB.
- **Looking for the build script?** `build_static.py` at the repo root.
- **Looking for settings?** There are no settings — this is a static site. Netlify config lives in `netlify.toml`.
- **Thought you needed to run `convert_csv_to_json.py`?** You don't. The CSVs and the migration both live in history; the current build never touches either.

If you need one of these files for historical reference (e.g. to compare
the pre-v3 schema against the current one), read it in place — but don't
copy it into live code, and don't reactivate `settings_legacy_flat.py`
or `convert_csv_to_json.py` without first reading the current
architecture doc.

## Why these files are still here and not git-deleted

They're lightweight (~600 KB total), provide useful historical context
when triaging "why was this decision made" questions, and git rm'ing
them only saves working-tree clutter — `git log --all` would still find
them anyway. If you want to actually remove them in a future pass, go
for it; everything is safely recoverable from history.
