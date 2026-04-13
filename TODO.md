## Mining framework
- [ ] **Inspect RotorBuilds build-page DOM** — run `tools/mining/inspect_rotorbuilds_dom.py` locally; fill in real selectors in `rotorbuilds.py` `parse()`. Without this, every build parses to an empty shell.
- [ ] First real run: `python tools/mining/run_all.py --miner rotorbuilds --max 50 --dry` — verify output by eye
- [x] `aggregate_cooccurrence.py` hardened: cooccurrence inverted index added (fixes wingman.html schema mismatch), part-name canonicalization with noise stripping
- [x] ArduPilot Discourse miner: tag list expanded to 107 tags (FC, GPS, ESC, companion, camera, RC, airframe)
- [x] Blue UAS miner: full parse() implemented (4-strategy: __NEXT_DATA__, script JSON, HTML table, JS-rendered diagnostic)
- [x] SAM.gov miner: improved with dedup, 60-day window, DFR keywords, award data, title-level relevance filter
- [x] `mine_pilotinstitute.py` — script written, wired into forge_miners.yml (pilotinstitute job)
