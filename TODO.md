## Support page
- [x] Add non-RF tools to /support/ page (added to tools-home.html):
  - PID Tuning Tool (already exists at /pid-tuning/)
  - Build Audit (/audit/)
  - Troubleshooter (/troubleshoot/)
  - FPV Academy (/academy/)
  - Implementation Guides (/guides/)
  - Consider grouping: RF Tools / Tuning & Diagnostics / Learning

## DFR
- [x] Add 5 compliance KB entries to forge_troubleshooting.json — TS-DFR-006 through TS-DFR-010
- [ ] Run mine_pilotinstitute.py and merge output into dfr_master.json
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
- [x] /intel/ page scroll rate UX — f-string SyntaxError fixed in prior session via __ANALYTICS__ placeholder

## Patterns / PIE
- [x] PIE pipeline: self-ref scrubber added to generate_brief.py
- [ ] pie_brief.json and pie_weekly.json are in root SRC_DIR and get auto-copied to build/static/ via STATIC_EXTENSIONS — confirm pipeline writes to the right location after regeneration
- [ ] patterns.html — `plat-count-blueuas` hardcoded to 237; should fetch live from forge_database.json (currently done via fire-and-forget fetch in loadData, but initial render shows stale number)

## Platforms
- [x] /platforms/?filter= URL param routing (survey→mapping, inspection→keyword match)
- [x] KrattWorks Ghost Dragon corrected; other DM- entries reviewed — no additional fabrication found

## Hangar / Wingman Private
- [x] Tooth Phase 1 SQLite implementation
- [ ] Hangar FC write-back via MSP/MAVLink

## Mining framework (scaffolded 2026-04-11 — see tools/mining/README.md)
- [ ] **Inspect RotorBuilds build-page DOM** — save 3-5 sample pages to `tools/mining/output/.cache/` and fill in real selectors in `rotorbuilds.py` `parse()`. Without this, every build parses to an empty shell.
- [ ] First real run: `python tools/mining/run_all.py --miner rotorbuilds --max 50 --dry` — verify output by eye
- [ ] Confirm `aggregate_cooccurrence.py` produces meaningful `forge_co_occurrence.json`
- [x] Wire `wingman.html` to fetch and use `forge_co_occurrence.json`
- [ ] Blue UAS miner: inspect bluelist.dcma.mil DOM, fill in parse()
- [ ] ArduPilot Discourse miner: test against live `/tags.json`; expand hardware tag list
- [ ] SAM.gov miner: register for `SAM_GOV_API_KEY` at api.sam.gov, test opportunity search

## Wingman / Compliance (added this session)
- [ ] Audit `forge_manufacturer_status.json` — verify Brain FPV closure date, Draganfly acquisition status, Yuneec FCC exposure, FrSky ecosystem-share claim
- [x] Add subsidiaries/parent cross-linking UX in `/spec-sheets/` card
- [ ] Audit `forge_alternatives.json` — verify recommendations against real prices / availability
- [x] Extend `forge_manufacturer_status.json` with Unusual Machines' full subsidiary tree
- [x] Add Brave FPV as its own entry
