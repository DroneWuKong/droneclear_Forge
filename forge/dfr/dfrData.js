/**
 * DFR Data Adapters
 * Fetches from data/dfr/ and docs/dfr/ JSON files and normalizes
 * into the shapes expected by DFRDashboard and DFRIntelFeed.
 *
 * All fetches use relative paths — works in Netlify static builds
 * where the data directory is served alongside the frontend.
 *
 * Falls back to hardcoded defaults if fetch fails (sandbox, offline, etc.)
 */

// ─── BASE PATH ────────────────────────────────────────────────────────────────
// In Netlify deploy: /data/dfr/ is served from the repo root
// In local dev: adjust BASE to point at the Ai-Project data dir
const BASE = "/data/dfr";
const DOCS = "/docs/dfr";

// ─── FETCH WITH FALLBACK ──────────────────────────────────────────────────────
async function fetchJSON(path, fallback) {
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.json();
  } catch (e) {
    console.warn(`[DFR] fetch failed: ${path} — using fallback`, e.message);
    return fallback;
  }
}

// ─── PLATFORM ADAPTER ─────────────────────────────────────────────────────────
// Converts platforms_v1.json shape → DFRDashboard PLATFORMS shape
function adaptPlatform(p) {
  const specs = p.specs || {};
  return {
    id: p.id,
    name: `${p.manufacturer} ${p.model}`,
    ndaa: p.ndaa_compliant,
    blue_uas: p.blue_uas_listed,
    ael: p.ael_eligible,
    grant_friction: p.grant_friction || (p.blue_uas_listed ? "LOW" : "MED"),
    speed: specs.max_speed_mph || specs.speed_mph || null,
    flight_time: specs.max_flight_time_min || specs.flight_time_min || null,
    thermal: specs.thermal_capable || false,
    cad: Array.isArray(p.cad_integrations) ? p.cad_integrations : [],
    use_cases: p.dfr_use_cases || [],
    price_signal: p.pricing_signal || "Quote",
    mfg: p.country_of_manufacture || "USA",
    dfr_native: specs.dfr_native || false,
    indoor: p.category === "dfr_indoor_tactical",
    alpr: specs.alpr || false,
    auto_dispatch: specs.auto_dispatch || false,
    foci: p.foci_concern ? true : false,
    supply_constraint: !!(p.supply_note || p.production_note),
    grant_notes: p.grant_notes || "",
    known_deployments: p.known_deployments || [],
  };
}

// ─── GRANT ADAPTER ────────────────────────────────────────────────────────────
// Converts COPS_Program.json / BSIR_HSGP_Program.json → DFRDashboard GRANTS shape
function adaptCOPS(data) {
  const g = data.dfr_relevant_grant_types?.[0] || {};
  return {
    id: "cops_tech",
    name: "COPS Technology",
    agency: "DOJ",
    ndaa_req: data.eligibility?.ndaa_compliance_required || true,
    ael_req: false,
    blue_uas_req: false,
    typical_award: g.typical_award_range || "$50K–$750K+",
    cycle: `${g.application_cycle || "Annual"} — closes ${data.timeline?.application_close || "Q2"}`,
  };
}

function adaptHSGP(data) {
  const shsp = data.programs?.find(p => p.abbreviation === "SHSP") || {};
  const uasi = data.programs?.find(p => p.abbreviation === "UASI") || {};
  return [
    {
      id: "hsgp_shsp",
      name: "HSGP / SHSP",
      agency: "DHS/FEMA",
      ndaa_req: shsp.ndaa_requirement || true,
      ael_req: true,
      blue_uas_req: false,
      typical_award: shsp.typical_dfr_award || "$50K–$500K",
      cycle: "Annual via SAA",
    },
    {
      id: "hsgp_uasi",
      name: "HSGP / UASI",
      agency: "DHS/FEMA",
      ndaa_req: uasi.ndaa_requirement || true,
      ael_req: true,
      blue_uas_req: false,
      typical_award: uasi.typical_dfr_award || "$100K–$1M+",
      cycle: "Annual via SAA — designated Urban Areas only",
    },
  ];
}

function adaptOhioPilot(data) {
  return {
    id: "ohio_dfr",
    name: "Ohio DFR Pilot",
    agency: "ODOT",
    ndaa_req: data.vendor_requirements?.ndaa_compliance_mandatory || true,
    ael_req: false,
    blue_uas_req: false,
    typical_award: `${data.financial_structure?.typical_package_cost?.total_typical_range || "$110K–$230K"}`,
    cycle: "Active — Ohio municipalities only",
  };
}

// ─── INTEL FEED ADAPTER ───────────────────────────────────────────────────────
// Converts dfr_master.json records → DFRIntelFeed card shape
const CHANNEL_MAP = {
  regulatory: { name: "Regulatory", color: "#ffb300" },
  platform_intel: { name: "Program Watch", color: "#00d4ff" },
  market_signal: { name: "Market Signal", color: "#00e676" },
  vendor_intel: { name: "Acquisition", color: "#ff6b35" },
  grant: { name: "Grant Intel", color: "#00e676" },
};

function adaptMasterRecord(r) {
  const ch = CHANNEL_MAP[r.data_category] || { name: "Intel", color: "#ffffff44" };
  // Derive confidence from source quality signals
  const confidence = r.source === "nasao_whitepaper" ? 97
    : r.source === "faa_gov_curated" ? 95
    : r.source === "dhs_fema_curated" ? 94
    : r.source === "dfr_agency_curated" ? 88
    : 85;
  // Is this a gray zone / premium record?
  const locked = r.data_category === "vendor_intel"
    || (r.title || "").toLowerCase().includes("[gray zone]")
    || (r.title || "").toLowerCase().includes("[acquisition]")
    || (r.title || "").toLowerCase().includes("[exclusive]");
  return {
    id: r.id,
    channel: ch.name,
    channelColor: ch.color,
    locked,
    date: r.pub_date || r.mined_at?.slice(0, 10) || "2026-04-06",
    title: r.title || "Untitled",
    body: r.summary || r.full_text_preview || "",
    confidence,
    tags: [r.data_category, r.source].filter(Boolean).map(t =>
      t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    ).slice(0, 3),
    source_url: r.url || "",
    vertical: r.vertical_tag || "dfr",
    data_category: r.data_category || "market_signal",
  };
}

// ─── BEYOND STATUS ADAPTER ────────────────────────────────────────────────────
function adaptBeyond(data) {
  const ov = data.overview || {};
  const part108 = data.part_108_monitoring || {};
  return {
    approved: 214,
    pending: 78,
    avg_days: 7,
    fastest_hours: 2,
    part_108: part108.expected || "Expected mid-2026",
    pathways: (data.pathway_options || []).map(p => ({
      name: p.name,
      time: p.timeline_current || "Varies",
      best: p.best_for,
    })),
    common_failure: data.common_failure_modes?.[0]?.failure || "Incomplete application",
    checklist_phases: (data.eligibility_checklist || []).length,
  };
}

// ─── GRANT MATRIX ADAPTER ─────────────────────────────────────────────────────
function adaptGrantMatrix(data) {
  return {
    platforms: (data.platforms || []).map(p => ({
      id: p.id,
      name: p.name,
      ndaa: p.ndaa_compliant,
      blue_uas: p.blue_uas_listed,
      foci: !!p.foci_concern,
      friction: p.procurement_friction,
      grants: p.grant_eligibility || {},
    })),
    programs: data.grant_programs || [],
    quick_ref: data.quick_reference || {},
  };
}

// ─── VENDOR SUPPORT ADAPTER ───────────────────────────────────────────────────
function adaptVendorRatings(data) {
  return (data.ratings || []).map(v => ({
    vendor: v.vendor,
    type: v.vendor_type,
    overall: v.ratings?.overall || 0,
    strengths: v.strengths || [],
    warnings: v.weaknesses || [],
    deployments: v.known_agency_deployments || v.known_agency_testimonials || [],
  }));
}

// ─── NASAO STATE DATA ADAPTER ─────────────────────────────────────────────────
function adaptNasaoRecords(records) {
  return records
    .filter(r => r.state && r.pct_fleet_impacted !== undefined)
    .map(r => ({
      state: r.state,
      pct: r.pct_fleet_impacted,
      airframes: r.airframes_impacted,
      investment: r.investment_at_risk,
      severity: r.severity,
      notes: r.notes || "",
    }))
    .sort((a, b) => (b.pct || 0) - (a.pct || 0));
}

// ─── MAIN LOADER ──────────────────────────────────────────────────────────────
export async function loadDFRData() {
  const [
    platformsRaw,
    masterRaw,
    copsRaw,
    hsgpRaw,
    ohioRaw,
    beyondRaw,
    grantMatrixRaw,
    vendorRaw,
    nasaoRaw,
  ] = await Promise.all([
    fetchJSON(`${BASE}/platforms/dfr_platforms_v1.json`, { platforms: [], docks: [] }),
    fetchJSON(`${BASE}/dfr_master.json`, { records: [], meta: {} }),
    fetchJSON(`${DOCS}/grants/COPS_Program.json`, null),
    fetchJSON(`${DOCS}/grants/BSIR_HSGP_Program.json`, null),
    fetchJSON(`${DOCS}/grants/Ohio_DFR_Pilot.json`, null),
    fetchJSON(`${DOCS}/reports/BEYOND_Pathway_Guide.json`, null),
    fetchJSON(`${BASE}/grant_eligibility_matrix.json`, { platforms: [], grant_programs: [] }),
    fetchJSON(`${BASE}/vendor_support_ratings.json`, { ratings: [] }),
    fetchJSON(`${BASE}/raw/nasao_whitepaper_2026-04-06.json`, []),
  ]);

  // Adapt platforms
  const platforms = (platformsRaw.platforms || []).map(adaptPlatform);

  // Adapt grants
  const grants = [
    ...(copsRaw ? [adaptCOPS(copsRaw)] : []),
    ...(hsgpRaw ? adaptHSGP(hsgpRaw) : []),
    ...(ohioRaw ? [adaptOhioPilot(ohioRaw)] : []),
  ];

  // Adapt intel feed cards from master
  const feedCards = (masterRaw.records || [])
    .filter(r => r.vertical_tag === "dfr")
    .map(adaptMasterRecord)
    .sort((a, b) => b.date.localeCompare(a.date));

  // Adapt BEYOND status
  const beyond = beyondRaw ? adaptBeyond(beyondRaw) : null;

  // Adapt grant matrix
  const grantMatrix = adaptGrantMatrix(grantMatrixRaw);

  // Adapt vendor ratings
  const vendors = adaptVendorRatings(vendorRaw);

  // Adapt NASAO state data
  const nasaoStates = adaptNasaoRecords(Array.isArray(nasaoRaw) ? nasaoRaw : []);

  return { platforms, grants, feedCards, beyond, grantMatrix, vendors, nasaoStates };
}

// ─── STATIC FALLBACKS ─────────────────────────────────────────────────────────
// Used when fetches fail — keeps UI functional during pipeline warmup
export const FALLBACK_PLATFORMS = [
  { id: "skydio_x10d", name: "Skydio X10D", ndaa: true, blue_uas: true, ael: true, grant_friction: "LOW", speed: 45, flight_time: 40, thermal: true, cad: ["Axon Evidence", "Fusus RTCC", "ESRI Site Scan"], use_cases: ["patrol", "sar", "fire"], price_signal: "Premium", mfg: "USA" },
  { id: "skydio_r10", name: "Skydio R10", ndaa: true, blue_uas: true, ael: true, grant_friction: "LOW", speed: 45, flight_time: 35, thermal: true, cad: ["Axon Evidence", "Fusus RTCC", "ESRI", "Motorola"], use_cases: ["patrol", "sar"], price_signal: "Premium", mfg: "USA", dfr_native: true },
  { id: "flock_alpha", name: "Flock Alpha", ndaa: true, blue_uas: false, ael: true, grant_friction: "MED", speed: 60, flight_time: 45, thermal: true, cad: ["Flock911", "Motorola PremierOne"], use_cases: ["patrol", "crowd"], price_signal: "Premium", mfg: "USA", alpr: true, auto_dispatch: true },
  { id: "brinc_lemur2", name: "BRINC Lemur 2", ndaa: true, blue_uas: true, ael: true, grant_friction: "LOW", speed: 20, flight_time: 20, thermal: true, cad: [], use_cases: ["indoor_tactical"], price_signal: "Premium", mfg: "USA (Seattle)", indoor: true },
  { id: "parrot_anafi", name: "Parrot ANAFI USA", ndaa: true, blue_uas: true, ael: true, grant_friction: "MED", speed: 35, flight_time: 32, thermal: true, cad: ["DroneSense"], use_cases: ["sar", "fire", "traffic"], price_signal: "~$7–10K", mfg: "USA (MA)", foci: true },
  { id: "if800", name: "Inspired Flight IF800", ndaa: true, blue_uas: true, ael: true, grant_friction: "LOW", speed: 40, flight_time: 35, thermal: true, cad: ["DroneSense"], use_cases: ["patrol", "sar"], price_signal: "Quote", mfg: "USA", supply_constraint: true },
];

export const FALLBACK_GRANTS = [
  { id: "cops_tech", name: "COPS Technology", agency: "DOJ", ndaa_req: true, ael_req: false, blue_uas_req: false, typical_award: "$50K–$750K+", cycle: "Annual Q1–Q2" },
  { id: "hsgp_shsp", name: "HSGP / SHSP", agency: "DHS/FEMA", ndaa_req: true, ael_req: true, blue_uas_req: false, typical_award: "$50K–$500K", cycle: "Annual via SAA" },
  { id: "hsgp_uasi", name: "HSGP / UASI", agency: "DHS/FEMA", ndaa_req: true, ael_req: true, blue_uas_req: false, typical_award: "$100K–$1M+", cycle: "Annual via SAA" },
  { id: "ohio_dfr", name: "Ohio DFR Pilot", agency: "ODOT", ndaa_req: true, ael_req: false, blue_uas_req: false, typical_award: "$110K–$230K", cycle: "Active — OH only" },
];

export const FALLBACK_BEYOND = {
  approved: 214, pending: 78, avg_days: 7, fastest_hours: 2, part_108: "Expected mid-2026",
  pathways: [
    { name: "Part 107 BVLOS Waiver", time: "< 1 week", best: "Most DFR programs" },
    { name: "Certificate of Authorization (COA)", time: "Varies", best: "Persistent / large-area ops" },
    { name: "Part 107 + COA combined", time: "Sequential", best: "Maximum flexibility" },
  ],
  common_failure: "Incomplete application",
  checklist_phases: 5,
};

export const FALLBACK_NASAO = [
  { state: "Wisconsin", pct: 100, severity: "SEVERE", investment: "~$12,000" },
  { state: "New York", pct: 92, severity: "SEVERE", investment: "~$150,000" },
  { state: "Oregon", pct: 95, severity: "SEVERE", investment: ">$250,000" },
  { state: "Colorado", pct: 90, severity: "SEVERE", investment: null },
  { state: "Nebraska", pct: 86, severity: "MODERATE", investment: "~$45,000" },
  { state: "Indiana", pct: 85, severity: "SEVERE", investment: "~$400,000" },
  { state: "Minnesota", pct: 84, severity: "MODERATE", investment: "$150-200K" },
  { state: "Georgia", pct: 80, severity: "SEVERE", investment: "~$225,000" },
];
