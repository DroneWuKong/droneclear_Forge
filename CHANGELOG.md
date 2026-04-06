# Changelog

## [Unreleased] - 2026-04-06

### Added
- **DFR Vertical — Phase 2 complete**: Full drone-as-first-responder intelligence platform
- **Data pipeline**: 9 miners (DRONERESPONDERS, Police1, DroneDJ, Commercial UAV, FAA BEYOND, DHS AEL, Grants.gov, Municipal RFP, NASAO White Paper), normalize.py, dfr_master.json canonical DB
- **Platform database**: dfr_platforms_v1.json — 8 platforms + 5 docks with NDAA/Blue UAS/AEL/CAD fields
- **Grant intelligence**: COPS_Program.json, BSIR_HSGP_Program.json, Ohio_DFR_Pilot.json — full program structures
- **Compliance data**: BEYOND_Pathway_Guide.json (5-phase), Program_Standup_Checklist.json (30-item), grant_eligibility_matrix.json, cad_integration_matrix.json
- **NASAO White Paper**: Full Oregon/NASAO DJI fleet grounding report indexed — 16 state records, 467 airframes grounded, Wisconsin 100%
- **Wisconsin market brief**: Wisconsin_DJI_Market_Brief.json — Seiler dealer analysis, known at-risk programs, grant path
- **Dealer network correlation**: Dealer_Network_Correlation.json — Seiler, Frontier Precision, Duncan-Parnell, UVT mapped against NASAO state data
- **Full ecosystem analysis**: Advexure, DSLRPros, DroneNerds, Airworx, SkyFireAI + balanced responsibility chain assessment
- **Global source registry**: Source_Registry_Global.json — 62 US + international intel sources with miner status
- **Forge UI — DFRDashboard.jsx**: 5-tab platform (platforms, grants, missions, BEYOND, reports)
- **Forge UI — DFRIntelFeed.jsx**: Intel feed with 9 seed cards, sidebar, category filters, vertical tab switcher
- **Forge UI — dfrData.js**: Data adapter layer — async fetch + normalize for all 9 JSON data sources, fallbacks for all
- **Data wiring**: DFRDashboard and DFRIntelFeed now fetch live from data/dfr/ and docs/dfr/ JSON files with graceful fallback
- **GitHub Actions**: dfr_miners.yml — all 9 miners scheduled + wired for automated pipeline
- **Mission recommender CLI**: mission_recommender.py — 7-mission platform recommendations

### Changed
- DFRIntelFeed: replaced static DFR_FEED array with SEED_CARDS + live merge from dfr_master.json
- DFRDashboard: replaced hardcoded PLATFORMS/GRANTS/BEYOND_STATUS with live state + loadDFRData()
- Both components now show LIVE/CACHED status indicator in header
