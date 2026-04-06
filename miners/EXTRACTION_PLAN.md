# Forge Data Extraction Plan

> Master plan for systematic data mining across all Forge and Handbook databases.
> Each miner targets specific gaps identified in the March 2026 audit.

---

## Current State (March 2026 Audit)

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Total parts | 3,538 | 5,000+ | Need more receivers, VTX, control TX, LiDAR |
| Parts with pricing | 99.7% | 100% | ✅ Nearly complete |
| Parts with links | 83% | 95% | 617 parts missing product links |
| Parts with images | 77% | 90% | 808 parts missing images |
| Parts with descriptions | 83% | 95% | 596 parts missing descriptions |
| Parts with datasheets | 0% | 30% | manual_link field completely empty |
| Platforms | 219 | 300+ | Need more Blue UAS, European, Asian |
| Platforms with specs | 0% | 80% | speed, range, endurance, payload all empty |
| Platforms with images | 31% | 80% | 150 platforms missing images |
| Platforms with pricing | 0% | 50% | No platform pricing at all |
| Intel funding entries | 28 | 100+ | Need weekly scraping |
| Intel contract entries | 29 | 100+ | Need SBIR + procurement feeds |

---

## Miner Architecture

```
miners/
├── mine_all.py              # Orchestrator — runs everything, merges, deduplicates
├── README.md                # Documentation
│
├── commercial/              # Product & parts data
│   ├── mine_getfpv.py       # GetFPV catalog scraper (primary)
│   ├── mine_rdq.py          # RaceDayQuads catalog
│   ├── mine_vtx_ua.py       # vtx.in.ua (Ukrainian combat parts)
│   ├── mine_manufacturer.py # Direct manufacturer sites (T-Motor, EMAX, etc.)
│   └── mine_aliexpress.py   # AliExpress drone parts (price comparison)
│
├── defense/                 # DoD, NATO, compliance data
│   ├── mine_sbir.py         # SBIR.gov awards (existing)
│   ├── mine_blueuas.py      # DIU Blue UAS list (existing)
│   ├── mine_sam.py          # SAM.gov contract awards
│   ├── mine_fpds.py         # FPDS-NG (Federal procurement)
│   └── mine_diu.py          # Defense Innovation Unit portal
│
├── intel/                   # News, funding, regulatory
│   ├── mine_dronelife.py    # DRONELIFE (existing)
│   ├── mine_suasnews.py     # sUAS News
│   ├── mine_crunchbase.py   # Crunchbase (funding rounds)
│   └── mine_sec.py          # SEC EDGAR (public company filings)
│
├── platforms/               # Drone platform specs
│   ├── mine_specs.py        # Manufacturer spec sheets (PDFs + web)
│   ├── mine_wikipedia.py    # Wikipedia infoboxes for military platforms
│   └── mine_janes.py        # Jane's-style open source military data
│
└── enrichment/              # Fill gaps in existing entries
    ├── enrich_images.py     # Find product images via manufacturer sites
    ├── enrich_datasheets.py # Find PDF datasheets for parts
    ├── enrich_descriptions.py # Generate descriptions from specs
    └── enrich_platform_specs.py # Fill speed/range/endurance/payload
```

---

## Priority 1: Commercial Parts (biggest volume gap)

### 1A. GetFPV Deep Scrape (`mine_getfpv.py`)

**Source:** getfpv.com — 2,730 links already, but missing newer products + categories
**Target fields:** name, manufacturer, price, description, image_url, specs, link
**Method:** Scrape category listing pages → product detail pages → extract structured data

Categories to scrape:
- `/fpv/cameras.html` → fpv_cameras (fill 3 missing)
- `/fpv/video-transmitters.html` → video_transmitters (fill 21 missing)
- `/fpv/antennas.html` → antennas (already good)
- `/fpv/receivers.html` → receivers (**267 missing links** — biggest gap)
- `/radios/` → control_link_tx (**137 all missing** — new category)
- `/fpv/goggles.html` → fpv_detectors (**30 all missing**)
- `/commercial-industry-drones/ndaa-compliant.html` → NDAA parts cross-reference

```python
# Extraction pattern per product page:
{
    "name": "h1.product-name",
    "manufacturer": "span.product-brand",
    "price": "span.price",
    "description": "div.product-description",
    "image": "img.product-image @src",
    "specs": "table.product-specs tr → key:value pairs",
    "sku": "span.product-sku",
    "in_stock": "div.stock-status",
    "ndaa": "presence of NDAA badge/tag"
}
```

**Estimated yield:** 400-600 new parts, 600+ link/image/description fills

### 1B. RaceDayQuads (`mine_rdq.py`)

**Source:** racedayquads.com
**Target:** Price comparison data, parts not on GetFPV
**Method:** Category pages → product detail → price + availability
**Estimated yield:** 200 new parts, price cross-reference for 1,000+

### 1C. vtx.in.ua Refresh (`mine_vtx_ua.py`)

**Source:** vtx.in.ua — Ukrainian FPV shop, combat-tested parts
**Target:** Ukrainian-manufactured components (603700, Flytex, DiFly, LEADER Tech)
**Method:** Already have 574 parts. Refresh for new listings, updated UAH prices.
**Estimated yield:** 50-100 new Ukrainian combat parts

### 1D. Direct Manufacturer Sites (`mine_manufacturer.py`)

**Source:** Individual OEM sites for categories we can't get from retailers
**Priority manufacturers:**

| Manufacturer | URL | Target Category | Gap |
|-------------|-----|-----------------|-----|
| Silvus Technologies | silvustechnologies.com | mesh_radios | Specs, datasheets |
| Persistent Systems | persistentsystems.com | mesh_radios | MPU5 variants |
| Doodle Labs | doodlelabs.com | mesh_radios | Helix variants |
| Ouster | ouster.com | lidar | OS0/OS1/OS2 specs |
| Livox | livoxtech.com | lidar | Mid-40/70, HAP, Avia |
| NVIDIA | nvidia.com/jetson | companion_computers | Jetson lineup |
| ModalAI | modalai.com | companion_computers | VOXL2 variants |
| Obsidian Sensors | obsidiansensors.com | thermal_cameras | Full lineup |
| Teledyne FLIR | flir.com/oem | thermal_cameras | Boson/Lepton specs |
| Workswell | workswell.cz | thermal_cameras | WIRIS series |

**Method:** Product pages → spec tables → structured extraction
**Estimated yield:** 100-200 enriched parts with full specs + datasheets

---

## Priority 2: Platform Specs (0% filled)

### 2A. Platform Spec Extraction (`mine_specs.py`)

**Problem:** 219 platforms, 0% have speed/range/endurance/payload data
**Source:** Manufacturer websites, spec sheets, Wikipedia infoboxes
**Target fields per platform:**

```json
{
    "max_speed_kmh": null,        // 0% filled
    "cruise_speed_kmh": null,     // 0% filled
    "max_range_km": null,         // 0% filled
    "max_endurance_min": null,    // 0% filled
    "max_payload_kg": null,       // 0% filled
    "mtow_kg": null,              // 0% filled
    "wingspan_m": null,           // 0% filled
    "operating_altitude_m": null, // 0% filled
    "price_usd": null,            // 0% filled
    "image_url": null,            // 31% filled
    "datasheet_url": null         // 0% filled
}
```

**Method:**
1. For each platform, search manufacturer website for spec sheet
2. Parse spec table (HTML or PDF) → extract numeric values with units
3. Normalize units (knots→km/h, miles→km, lbs→kg, ft→m)
4. Cross-validate against Wikipedia/Jane's data where available

**Priority platforms** (Blue UAS + combat-proven first):
- Shield AI V-BAT, Nova 2, X-BAT
- Skydio X2, X10
- AeroVironment Switchblade 300/600, Puma 3
- Baykar TB2, TB3, Akinci, Kizilelma
- Tekever AR3, AR5
- Parrot ANAFI USA/UKR
- Red Cat FANG F7, Black Widow
- All 26 Blue UAS listed platforms

**Estimated yield:** 150+ platforms with full specs

### 2B. Wikipedia Military Platform Data (`mine_wikipedia.py`)

**Source:** Wikipedia infoboxes for military drones
**Method:** Parse infobox template for `{{Infobox aircraft}}` → extract specs
**Target:** All military platforms in DB (80+ entries)
**Fields:** Crew, length, wingspan, height, weight, max_speed, range, ceiling, endurance, engine, cost

**Estimated yield:** 80 platforms with partial specs

---

## Priority 3: Defense & Procurement Data

### 3A. SAM.gov Contract Awards (`mine_sam.py`)

**Source:** SAM.gov (System for Award Management) — all federal contracts
**Method:** Search API for UAS/drone-related contract awards
**Keywords:** "unmanned aerial", "UAS", "counter-UAS", "drone", "sUAS", "VTOL unmanned"
**Target:** Contract awards > $100K to drone companies in our DB
**Fields:** awardee, value, agency, date, description, NAICS code

**Estimated yield:** 50-100 contract entries per quarter

### 3B. FPDS-NG (`mine_fpds.py`)

**Source:** Federal Procurement Data System — detailed contract line items
**Method:** API query for specific vendors (Shield AI, Fortem, Skydio, etc.)
**Target:** Granular procurement data — what exactly DoD is buying
**Estimated yield:** 30-50 detailed contract records

### 3C. DIU Portal Scrape (`mine_diu.py`)

**Source:** diu.mil — Defense Innovation Unit
**Target:** Blue UAS list updates, Replicator program awards, CCA updates
**Method:** Check for list changes monthly. Diff against known list.
**Estimated yield:** 5-10 new platforms/components per quarter

---

## Priority 4: Intel Feed (News & Finance)

### 4A. sUAS News (`mine_suasnews.py`)

**Source:** suasnews.com — oldest UAS news outlet
**Method:** RSS feed or listing page scrape → classify articles
**Target:** Product launches, regulatory updates, industry analysis
**Estimated yield:** 20-30 articles/week, 5-10 classified intel entries/week

### 4B. Crunchbase (`mine_crunchbase.py`)

**Source:** Crunchbase — startup funding database
**Method:** Search for drone/UAS companies → extract funding rounds
**Target:** All VC-funded drone companies with >$5M raised
**Fields:** company, amount, round_type, date, investors, valuation
**Estimated yield:** 50-100 funding entries

### 4C. SEC EDGAR (`mine_sec.py`)

**Source:** SEC EDGAR — public company filings
**Target:** Red Cat (RCAT), AeroVironment (AVAV), Kratos (KTOS), L3Harris (LHX)
**Method:** Parse 10-K/10-Q for drone segment revenue, backlog, guidance
**Fields:** revenue, backlog, guidance, drone_segment_data
**Estimated yield:** Quarterly financial updates for 5-10 public companies

---

## Priority 5: Enrichment (fill gaps in existing entries)

### 5A. Image Finder (`enrich_images.py`)

**Problem:** 808 parts + 150 platforms missing images
**Method:** For each part without image_file:
1. Search manufacturer website for product image
2. Fall back to Google Images API (product name + manufacturer)
3. Download, resize to standard dimensions, store URL
**Target:** 90% image coverage (from 77%)

### 5B. Datasheet Finder (`enrich_datasheets.py`)

**Problem:** 0% manual_link (datasheet) coverage
**Method:** For each part:
1. Search manufacturer site for PDF datasheet
2. Search Google: `"{product name}" filetype:pdf datasheet`
3. Store URL in manual_link field
**Priority:** Flight controllers, ESCs, companion computers, sensors
**Target:** 30% datasheet coverage for technical categories

### 5C. Description Generator (`enrich_descriptions.py`)

**Problem:** 596 parts missing descriptions
**Method:** For parts with specs but no description:
1. Generate description from schema_data fields
2. Template: "{name} by {manufacturer}. {key_spec_1}, {key_spec_2}. {category_context}."
3. No AI generation — pure template concatenation from existing data
**Target:** 95% description coverage (from 83%)

### 5D. Platform Spec Enrichment (`enrich_platform_specs.py`)

**Problem:** 219 platforms with 0% speed/range/endurance/payload
**Method:** Combine data from:
1. Handbook drone_models.json (already has some specs)
2. Wikipedia infobox extraction
3. Manufacturer spec sheet parsing
4. Manual research for high-priority platforms
**Target:** 80% spec coverage for platforms

---

## Execution Schedule

### Week 1: Foundation
- [ ] `mine_getfpv.py` — receivers, control_link_tx, fpv_detectors (biggest gaps)
- [ ] `enrich_descriptions.py` — template-based description fill
- [ ] `enrich_platform_specs.py` — Blue UAS platforms first

### Week 2: Defense
- [ ] `mine_sam.py` — SAM.gov contract scraper
- [ ] `mine_specs.py` — Shield AI, Fortem, Tekever, Red Cat platform specs
- [ ] `mine_wikipedia.py` — Military platform infoboxes

### Week 3: Commercial
- [ ] `mine_rdq.py` — RaceDayQuads price comparison
- [ ] `mine_manufacturer.py` — LiDAR, mesh radio, thermal OEM sites
- [ ] `enrich_images.py` — Image finder for 800+ missing

### Week 4: Intel
- [ ] `mine_suasnews.py` — News feed
- [ ] `mine_crunchbase.py` — Funding rounds
- [ ] `mine_sec.py` — Public company filings

### Ongoing (weekly)
- [ ] `mine_dronelife.py` — Already built, run weekly
- [ ] `mine_sbir.py` — Already built, run monthly
- [ ] `mine_blueuas.py` — Already built, run monthly
- [ ] `mine_all.py` — Orchestrator, run weekly

---

## Technical Notes

### Rate Limiting
- GetFPV: 1 req/sec, rotate user agents
- SAM.gov: API key required (free), 100 req/min
- SBIR.gov: No auth, 10 req/min recommended
- Wikipedia: 200 req/min (etiquette)
- SEC EDGAR: 10 req/sec, identify via User-Agent

### Data Quality
- All scraped data goes through deduplication (PID-based)
- Price data includes source + date for freshness tracking
- Specs normalized to SI units (metric) with US units as secondary
- Description generation is template-only — no hallucinated content
- Images stored as URLs, not downloaded (CDN references)

### Storage
- All data flows into `forge_database.json` (parts + platforms)
- Intel data flows into `forge_intel.json` (funding + contracts + news)
- Both files are version-controlled in git
- `mine_all.py` handles merge + dedup + version bump

---

*Last updated: March 2026*
*Author: Forge Data Pipeline*
