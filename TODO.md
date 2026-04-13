## Mining framework
- [ ] **Inspect RotorBuilds build-page DOM** — run `tools/mining/inspect_rotorbuilds_dom.py` locally; fill in real selectors in `rotorbuilds.py` `parse()`. Without this, every build parses to an empty shell.
- [ ] First real run: `python tools/mining/run_all.py --miner rotorbuilds --max 50 --dry` — verify output by eye
- [ ] `aggregate_cooccurrence.py` → `forge_co_occurrence.json` — blocked on RotorBuilds parse() being wired; file doesn't exist yet so wingman co-occurrence check is a no-op
- [ ] ArduPilot Discourse miner: tag list scaffolded; run locally or via GH Actions
- [ ] Blue UAS miner: DOM inspection needed (bluelist.dcma.mil may be JS-rendered — try Playwright)
- [ ] SAM.gov miner: add `SAM_GOV_API_KEY` to Ai-Project secrets when arrives; miner scaffolded and ready
- [ ] `mine_pilotinstitute.py` — script needs to be written; run via GitHub Actions
