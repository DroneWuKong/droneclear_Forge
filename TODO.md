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
- [ ] Stripe: rename STRIPE_PRO_PRICE_ID → STRIPE_DFR_PRICE_ID and create STRIPE_COMMERCIAL_PRICE_ID in Netlify env vars
- [ ] Set GITHUB_PAT in Forge Netlify env (required for Ai-Project build-time clone)
- [ ] Verify /intel-dfr/ page live and correctly displays 14-platform DB
- [ ] Add Percepto Sparrow NDAA status — verify with vendor before enabling for federal procurement recommendations

## Document Builder
- [ ] Add state law overlay to property_access template (flag state-specific restrictions)
- [ ] Add "send to client" email draft button on generated commercial docs
- [ ] Consider adding Subpart D category compliance guide (over-people ops) as free doc

## Admin / Token Console
- [ ] Rotate PAT exposed in chat session ([REVOKED-PAT] — revoke immediately)
- [ ] Add token count by tier to admin sidebar stats (Commercial: N / DFR: N / Agency: N)

## Analytics
- [ ] Confirm /analytics/ at thebluefairy.netlify.app is live vs. mock data
- [ ] /intel/ page scroll rate UX improvement (build_static.py f-string)

## Hangar / Wingman Private
- [ ] Tooth Phase 1 SQLite implementation
- [ ] Hangar FC write-back via MSP/MAVLink
