## Support page
- [ ] Add non-RF tools to /support/ page:
  - PID Tuning Tool (already exists at /pid-tuning/)
  - Build Audit (/audit/)
  - Troubleshooter (/troubleshoot/)
  - FPV Academy (/academy/)
  - Implementation Guides (/guides/)
  - Consider grouping: RF Tools / Tuning & Diagnostics / Learning

## DFR
- [ ] Add 5 compliance KB entries to forge_troubleshooting.json (from DFR Regulatory Brief)
- [ ] Run mine_pilotinstitute.py and merge output into dfr_master.json
- [x] Stripe: rename STRIPE_PRO_PRICE_ID → STRIPE_DFR_PRICE_ID and create STRIPE_COMMERCIAL_PRICE_ID in Netlify env vars
- [ ] **SET GITHUB_PAT in Forge Netlify env** — required for Ai-Project build-time clone; without it platform counts show incorrectly
- [ ] Verify /intel-dfr/ page live and correctly displays 14-platform DB
- [ ] Add Percepto Sparrow NDAA status — verify with vendor before enabling for federal procurement recommendations

## Document Builder
- [ ] Add state law overlay to property_access template (flag state-specific restrictions)
- [ ] Add "send to client" email draft button on generated commercial docs
- [ ] Consider adding Subpart D category compliance guide (over-people ops) as free doc

## Admin / Token Console
- [x] Rotate PAT — revoke old token, set new GITHUB_PAT in Netlify env vars
- [ ] Add token count by tier to admin sidebar stats (Commercial: N / DFR: N / Agency: N)

## Analytics
- [ ] Confirm /analytics/ at thebluefairy.netlify.app is live vs. mock data
- [ ] /intel/ page scroll rate UX improvement (build_static.py f-string)

## Patterns / PIE
- [ ] PIE pipeline: add hedge generation guardrail — prompt must explicitly ban self-referential Forge/DroneClear mentions
- [ ] pie_brief.json and pie_weekly.json are in root SRC_DIR and get auto-copied to build/static/ via STATIC_EXTENSIONS — confirm pipeline writes to the right location after regeneration
- [ ] patterns.html — `plat-count-blueuas` hardcoded to 237; should fetch live from forge_database.json (currently done via fire-and-forget fetch in loadData, but initial render shows stale number)

## Platforms
- [x] /platforms/?filter= URL param routing (survey→mapping, inspection→keyword match)
- [ ] KrattWorks Ghost Dragon DM-0032 had stale fabricated specs — corrected this session; verify no other DM- entries have similarly fabricated data

## Hangar / Wingman Private
- [ ] Tooth Phase 1 SQLite implementation
- [ ] Hangar FC write-back via MSP/MAVLink
