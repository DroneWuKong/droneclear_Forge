## Mining framework
- [ ] **Inspect RotorBuilds build-page DOM** — run `tools/mining/inspect_rotorbuilds_dom.py` locally; fill in real selectors in `rotorbuilds.py` `parse()`. Without this, every build parses to an empty shell.
- [ ] First real run: `python tools/mining/run_all.py --miner rotorbuilds --max 50 --dry` — verify output by eye
- [ ] `aggregate_cooccurrence.py` → `forge_co_occurrence.json` — blocked on RotorBuilds parse() being wired; file doesn't exist yet so wingman co-occurrence check is a no-op
- [ ] ArduPilot Discourse miner: tag list scaffolded; blocked on network access — run locally or via GH Actions
- [ ] Blue UAS miner: scaffold complete; DOM inspection needed (bluelist.dcma.mil may be JS-rendered — try Playwright)
- [ ] SAM.gov miner: API key pending approval at api.sam.gov — add `SAM_GOV_API_KEY` to Ai-Project secrets when arrives; miner scaffolded and ready

## DFR
- [ ] Run `mine_pilotinstitute.py` — not in repo yet; needs to be written and run via GitHub Actions (proxy-blocked in sandbox)
- [ ] **SET GITHUB_PAT in Forge Netlify env** — sync_to_aiproject.yml uses `SYNC_PAT` (already set), but build-time Ai-Project clone needs separate `GITHUB_PAT` in Netlify; platform counts will show incorrectly without it
- [ ] Verify `/intel-dfr/` page live — page is built (registered in build_static.py), 14 platforms in dfr_platforms_v1.json; verify deploy is current and data renders correctly

## Analytics
- [ ] Confirm `/analytics/` at thebluefairy.netlify.app shows live data vs mock — page fetches from `analytics-dashboard` function; verify function is deployed and returning real data
