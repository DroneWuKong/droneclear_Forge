## Support page
- [ ] Add non-RF tools to /support/ page:
  - PID Tuning Tool (already exists at /pid-tuning/)
  - Build Audit (/audit/)
  - Troubleshooter (/troubleshoot/)
  - FPV Academy (/academy/)
  - Implementation Guides (/guides/)
  - Consider grouping: RF Tools / Tuning & Diagnostics / Learning

## DFR
- [x] Add 5 compliance KB entries to forge_troubleshooting.json — TS-DFR-006 through TS-DFR-010
- [ ] Run mine_pilotinstitute.py — proxy-blocked in sandbox, must run via GitHub Actions
- [x] Stripe: rename STRIPE_PRO_PRICE_ID → STRIPE_DFR_PRICE_ID and create STRIPE_COMMERCIAL_PRICE_ID in Netlify env vars
- [ ] **SET GITHUB_PAT in Forge Netlify env** — required for Ai-Project build-time clone; without it platform counts show incorrectly
- [ ] Verify /intel-dfr/ page live and correctly displays 14-platform DB
- [x] Add Percepto Sparrow (MDL-2172) — added with NDAA:false + procurement warning

## Document Builder
- [x] Add state law overlay to property_access template (flag state-specific restrictions)
- [x] Add "send to client" email draft button on generated commercial docs
- [x] Consider adding Subpart D category compliance guide (over-people ops) as free doc

## Admin / Token Console
- [x] Rotate PAT — revoke old token, set new GITHUB_PAT in Netlify env vars
- [x] Add token count by tier to admin sidebar stats (Commercial: N / DFR: N / Agency: N)

## Analytics
- [ ] Confirm /analytics/ at thebluefairy.netlify.app is live vs. mock data
- [x] /intel/ page scroll rate UX — duplicate analytics block removed from 51 HTML files; build_static.py SyntaxWarning fixed

## Patterns / PIE
- [x] PIE pipeline: self-ref scrubber added to generate_brief.py
- [x] pie_brief.json pipeline path confirmed — generate_brief writes data/pie_brief.json, pipeline step 6 copies to Forge viz dir
- [x] patterns.html — `plat-count-blueuas` hardcoded count replaced with — (live fetch on load)

## Platforms
- [x] /platforms/?filter= URL param routing (survey→mapping, inspection→keyword match)
- [x] KrattWorks Ghost Dragon DM-0032 corrected; DM- vehicle_type audit complete (DM-0064/0066/0078 fixed)

## Hangar / Wingman Private
- [x] Tooth Phase 1 SQLite implementation
- [x] Hangar FC write-back via MSP/MAVLink — FcTransport + MspClient + FcWriteBack implemented

## Mining framework (scaffolded 2026-04-11 — see tools/mining/README.md)
- [ ] **Inspect RotorBuilds build-page DOM** — save 3-5 sample pages to `tools/mining/output/.cache/` and fill in real selectors in `rotorbuilds.py` `parse()`. Without this, every build parses to an empty shell.
- [ ] First real run: `python tools/mining/run_all.py --miner rotorbuilds --max 50 --dry` — verify output by eye
- [ ] Confirm `aggregate_cooccurrence.py` produces meaningful `forge_co_occurrence.json`
- [x] Wire `wingman.html` to fetch and use `forge_co_occurrence.json`
- [ ] Blue UAS miner: inspect bluelist.dcma.mil DOM, fill in parse()
- [ ] ArduPilot Discourse miner: test against live `/tags.json`; expand hardware tag list
- [ ] SAM.gov miner: register for `SAM_GOV_API_KEY` at api.sam.gov, test opportunity search

## Wingman / Compliance
- [x] Audit `forge_manufacturer_status.json` — Brain FPV active (not defunct), Yuneec/FrSky FCC Covered List flags, Draganfly clarified
- [x] Add subsidiaries/parent cross-linking UX in `/spec-sheets/` card — slug resolution, object/string normalisation, FCC Covered badge
- [x] Audit `forge_alternatives.json` — FCC Covered List flags (Walksnail/TBS/DJI), NDAA statuses, Jetson allocation warning
- [x] Extend `forge_manufacturer_status.json` with Unusual Machines' full subsidiary tree (Fat Shark, Rotor Riot, Rotor Lab, Brave FPV)
- [x] Add Brave FPV as its own entry — Blue UAS listed, US-made Orlando FL
