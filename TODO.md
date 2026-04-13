## Mining framework
- [ ] **Inspect RotorBuilds build-page DOM** — run `tools/mining/inspect_rotorbuilds_dom.py` locally; fill in real selectors in `rotorbuilds.py` `parse()`. Without this, every build parses to an empty shell.
- [ ] First real run: `python tools/mining/run_all.py --miner rotorbuilds --max 50 --dry` — verify output by eye
- [ ] `aggregate_cooccurrence.py` → `forge_co_occurrence.json` — blocked on RotorBuilds parse() being wired; file doesn't exist yet so wingman co-occurrence check is a no-op
- [x] ArduPilot Discourse miner: tag list expanded to 107 tags (FC, GPS, ESC, companion, camera, RC, airframe)
- [x] Blue UAS miner: full parse() implemented (4-strategy: __NEXT_DATA__, script JSON, HTML table, JS-rendered diagnostic)
- [ ] SAM.gov miner: add `SAM_GOV_API_KEY` to Ai-Project secrets when arrives; miner scaffolded and ready
- [x] `mine_pilotinstitute.py` — script written, wired into forge_miners.yml (pilotinstitute job)
