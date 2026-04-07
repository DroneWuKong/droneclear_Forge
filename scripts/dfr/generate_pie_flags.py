#!/usr/bin/env python3
"""
generate_pie_flags.py — DFR PIE Flag Generator

Reads dfr_master.json and produces PIE-compatible flags covering:
- Fleet grounding severity by state (regulatory_deadline)
- NASAO exposure signals (compliance)
- Dealer transition gaps (market_dynamics)
- Grant eligibility windows (procurement_spike)
- FAA BEYOND waiver momentum (regulatory)
- Platform availability gaps (supply_constraint)
- Exclusive market signals (osint)

Merges into pie_flags.json alongside existing flags.
Existing DFR flags replaced on re-run (idempotent by id prefix dfr_).

Usage:
    python3 scripts/dfr/generate_pie_flags.py
"""

import json
import hashlib
from datetime import datetime, timezone
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent.parent
DFR_MASTER   = ROOT / "data" / "dfr" / "dfr_master.json"
PIE_FLAGS    = ROOT / "DroneClear Components Visualizer" / "pie_flags.json"
TODAY        = datetime.now(timezone.utc).isoformat()

# ── Helpers ───────────────────────────────────────────────────────────────────
def flag_id(seed: str) -> str:
    return "dfr_" + hashlib.md5(seed.encode()).hexdigest()[:10]

def source(name, url, desc, validation="Curated from public records and primary sources."):
    return {
        "name": name, "url": url,
        "description": desc, "validation": validation,
        "type": "primary", "id": name.lower().replace(" ", "_")[:20]
    }

NASAO_SOURCE = source(
    "Oregon/NASAO White Paper",
    "https://www.oregon.gov/aviation/agency/about/Documents/Press%20Releases/OMB-FCC-Order%20Impact-White-Paper.pdf",
    "Oregon Dept of Aviation / NASAO multi-state survey. 25 state DOTs. 467 airframes grounded. Revised Feb 2026."
)
DFR_MASTER_SOURCE = source(
    "DroneClear DFR Master DB",
    "https://nvmillbuilditmyself.com/intel/feed/?tab=dfr",
    "DroneClear DFR intelligence database — curated records on fleet grounding, dealers, grants, platforms.",
    "Midwest Nice Advisory primary research. Cross-referenced with NASAO, FAA, DHS, and public procurement records."
)
FAA_SOURCE = source(
    "FAA BEYOND Program",
    "https://www.faa.gov/uas/advanced_operations/beyond_visual_line_of_sight",
    "FAA BEYOND waiver program tracking. 214+ approved waivers as of June 2025."
)
DHS_SOURCE = source(
    "DHS AEL / FEMA Grant Programs",
    "https://www.fema.gov/authorized-equipment-list",
    "DHS Authorized Equipment List and FEMA grant program documentation."
)

# ── Flag definitions ───────────────────────────────────────────────────────────
def build_flags(master: dict) -> list:
    flags = []
    records = master.get("records", [])

    # Find specific records
    nasao = next((r for r in records if "nasao" in r.get("id","").lower() and r.get("state_data")), None)
    faa   = next((r for r in records if "faa_beyond" in r.get("id","").lower() and r.get("key_facts")), None)
    wi    = next((r for r in records if "wisconsin" in r.get("id","").lower()), None)
    seiler = next((r for r in records if "seiler" in r.get("id","").lower()), None)
    frontier = next((r for r in records if "frontier" in r.get("id","").lower()), None)
    uvt   = next((r for r in records if "uvt" in r.get("id","").lower()), None)
    versaterm = next((r for r in records if "versaterm" in r.get("id","").lower()), None)

    # ── 1. NASAO National Fleet Grounding — CRITICAL ──────────────────────────
    flags.append({
        "id": flag_id("nasao_national_grounding"),
        "timestamp": TODAY,
        "flag_type": "regulatory_deadline",
        "severity": "critical",
        "category": "dfr",
        "title": "NASAO: 467 airframes grounded across 25 states — $50M–$2B national exposure",
        "detail": (
            "Oregon/NASAO Revision 2 white paper (Feb 2026): 467 drone airframes grounded or restricted "
            "across 23 states per survey of 25 state DOTs. National replacement exposure: $50M–$2B. "
            "Idaho benchmark: $15K DJI → $42K compliant (2.8x premium). Triggered by OMB M-26-02 "
            "(Nov 21 2025), FHWA guidance, and FCC Covered List action (Dec 22 2025). "
            "Phase-out deadline Dec 2027. NASAO recommends congressional waiver through Sept 2027."
        ),
        "confidence": 0.99,
        "prediction": "Replacement wave will drive $200M+ in procurement over 18 months. "
                      "Agencies without transition plans face audit findings and grant clawback risk.",
        "data_sources": ["oregon_nasao", "dfr_master"],
        "sources": [NASAO_SOURCE, DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "nasao-fleet-grounding",
    })

    # ── 2. State-level severity flags ─────────────────────────────────────────
    if nasao and nasao.get("state_data"):
        severe_states = [s for s in nasao["state_data"] if s.get("severity") == "SEVERE"]
        for s in severe_states:
            pct = s.get("pct", "?")
            invest = s.get("investment", "unknown")
            state = s["state"]
            flags.append({
                "id": flag_id(f"state_grounding_{state}"),
                "timestamp": TODAY,
                "flag_type": "compliance",
                "severity": "critical",
                "category": "dfr",
                "title": f"{state}: {pct}% of state drone fleet grounded — {invest} at risk",
                "detail": (
                    f"{state} Department of Transportation confirmed {pct}% of UAS fleet grounded "
                    f"or restricted under ASDA/OMB M-26-02. Investment at risk: {invest}. "
                    f"Budget for replacement: {s.get('budget','none allocated')}. "
                    "Agencies using FHWA, COPS, HSGP, or other federal grants cannot procure or operate "
                    "DJI. Any federally-funded project involving aerial data collection requires "
                    "NDAA-compliant platforms immediately."
                ),
                "confidence": 0.99,
                "prediction": f"{state} agencies face grant clawback risk if DJI fleets continue operating "
                              "on federally-funded projects. COPS Technology and HSGP grants available for transition.",
                "data_sources": ["oregon_nasao"],
                "sources": [NASAO_SOURCE],
                "platform_id": None,
                "component_id": None,
                "entity_id": f"state-grounding-{state.lower().replace(' ','-')}",
            })

    # ── 3. Wisconsin Exclusive ────────────────────────────────────────────────
    flags.append({
        "id": flag_id("wisconsin_exclusive"),
        "timestamp": TODAY,
        "flag_type": "osint",
        "severity": "critical",
        "category": "dfr",
        "title": "Wisconsin: 100% grounded, Seiler GeoDrones not pivoting, known programs at risk",
        "detail": (
            "Wisconsin DOT 100% grounded — worst classification in 25-state NASAO survey. "
            "No dedicated replacement budget. Seiler Instrument GeoDrones (est. 1945, 9 Midwest states) "
            "still featuring DJI Matrice 400 as flagship product as of April 2026 with no NDAA pivot. "
            "Known at-risk programs: Manitowoc County Sheriff (13 FAA-certified pilots, 2022 launch), "
            "Beaver Dam PD (thermal ops), Wisconsin Rapids PD. "
            "Idaho benchmark: $15K DJI → $42K compliant (2.8× premium). "
            "72 counties all likely exposed — WI DOT's 1 airframe count massively understates true exposure. "
            "COPS Technology and HSGP grants available but agencies need guidance on qualifying platforms."
        ),
        "confidence": 0.92,
        "prediction": "Wisconsin is the highest-urgency Midwest market. First mover with agency-level "
                      "outreach (Manitowoc, Beaver Dam) captures transition advisory relationship before "
                      "any compliant vendor establishes presence.",
        "data_sources": ["oregon_nasao", "dfr_master"],
        "sources": [NASAO_SOURCE, DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "wisconsin-fleet-grounding",
    })

    # ── 4. Dealer Gap — Seiler ────────────────────────────────────────────────
    flags.append({
        "id": flag_id("dealer_gap_seiler"),
        "timestamp": TODAY,
        "flag_type": "market_dynamics",
        "severity": "critical",
        "category": "dfr",
        "title": "Seiler GeoDrones: DJI dealer serving 9 Midwest states with no NDAA pivot — advisory vacuum",
        "detail": (
            "Seiler Instrument (est. 1945, St. Louis MO) is an authorized DJI Enterprise dealer "
            "serving 9 Midwest states including Wisconsin (100% grounded), Indiana (85%), and Nebraska (86%). "
            "As of April 2026 Seiler still features DJI Matrice 400 as flagship with no visible "
            "transition to NDAA-compliant alternatives. Seiler customers — state DOTs, county sheriffs, "
            "municipal PDs — hold stranded DJI assets with no replacement guidance from their incumbent dealer. "
            "This creates an advisory vacuum. Any NDAA-compliant vendor or advisor who reaches these "
            "agencies first owns the transition relationship."
        ),
        "confidence": 0.92,
        "prediction": "Seiler will eventually pivot but timeline unknown. Early outreach to Seiler "
                      "customer agencies (WI, IN, NE) before any competitor establishes presence "
                      "is the highest-leverage GTM action available.",
        "data_sources": ["dfr_master"],
        "sources": [DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "seiler-geodrones",
    })

    # ── 5. Dealer Signal — Frontier Precision (channel partner) ───────────────
    flags.append({
        "id": flag_id("dealer_signal_frontier"),
        "timestamp": TODAY,
        "flag_type": "market_dynamics",
        "severity": "warning",
        "category": "dfr",
        "title": "Frontier Precision: most advanced Trimble dealer NDAA pivot — channel partner candidate",
        "detail": (
            "Frontier Precision (est. 1988, Bismarck ND, employee-owned, 22+ states, "
            "9 Trimble Certified Service Centers) is the most advanced Trimble dealer in transitioning "
            "to NDAA-compliant platforms. Carrying Skydio, WISPR, Inspired Flight, ACSL SOTEN, "
            "Freefly, Quantum-Systems alongside DJI. Primary state exposures: Oregon 95% grounded "
            "(Frontier has Portland/Tigard service center), Colorado 90% (Arvada + Colorado Springs), "
            "Minnesota 84% (Minneapolis hub). Already advising customers on transition. "
            "Non-competitive referral or white-label arrangement possible."
        ),
        "confidence": 0.93,
        "prediction": "Frontier is the leading channel partner candidate for DFR compliance intel. "
                      "Direct outreach to explore referral arrangement — Frontier has agency relationships, "
                      "DroneClear has the compliance data layer.",
        "data_sources": ["dfr_master"],
        "sources": [DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "frontier-precision",
    })

    # ── 6. Channel Signal — UVT ───────────────────────────────────────────────
    flags.append({
        "id": flag_id("channel_signal_uvt"),
        "timestamp": TODAY,
        "flag_type": "procurement_spike",
        "severity": "warning",
        "category": "dfr",
        "title": "UVT: 2,400+ agency relationships, pure-play DFR, TIPS/Sourcewell — highest-leverage channel",
        "detail": (
            "Unmanned Vehicle Technologies (est. 2014, Fayetteville AR, founded by 911 dispatcher Chris Fink) "
            "serves 2,400+ government agencies nationwide. Tier I DJI Enterprise Dealer actively pivoting to "
            "NDAA-compliant platforms. TIPS Contract #240101, Sourcewell #011223-UNM — cooperative purchasing "
            "vehicles that agencies can use without competitive bid. Active DFR focus: FAA waiver support, "
            "site selection, SOP development. Nebraska 86% grounded is prime UVT territory. "
            "UVT has the agency relationships; DroneClear has the compliance intelligence data layer."
        ),
        "confidence": 0.93,
        "prediction": "Highest-leverage channel partner candidate. White-label or referral arrangement "
                      "with Chris Fink direct reaches 2,400 agencies faster than any direct sales effort.",
        "data_sources": ["dfr_master"],
        "sources": [DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "uvt-channel",
    })

    # ── 7. Versaterm/Aloft Acquisition ────────────────────────────────────────
    flags.append({
        "id": flag_id("versaterm_aloft_acquisition"),
        "timestamp": TODAY,
        "flag_type": "market_dynamics",
        "severity": "warning",
        "category": "dfr",
        "title": "Versaterm acquires Aloft (Feb 2026) — single-stack CAD + fleet + LAANC consolidation",
        "detail": (
            "Versaterm acquired DroneSense (July 2025) then Aloft (February 2026). "
            "Aloft powers the majority of US LAANC authorizations. Combined entity controls: "
            "DroneSense fleet management + Aloft airspace authorization + Versaterm CAD dispatch "
            "in a single vendor stack. Agencies can now dispatch drones from CAD like patrol/fire/EMS. "
            "Significant DFR software market consolidation. Raises single-vendor dependency risk. "
            "No announced price changes but combined platform lock-in increases switching costs."
        ),
        "confidence": 0.97,
        "prediction": "Versaterm will dominate DFR software for agencies using CAD-integrated dispatch. "
                      "Expect price increases post-consolidation. Agencies should evaluate multi-vendor "
                      "strategies before committing to full Versaterm stack.",
        "data_sources": ["dfr_master"],
        "sources": [DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "versaterm-aloft",
    })

    # ── 8. FAA BEYOND — Regulatory Momentum ──────────────────────────────────
    kf = faa.get("key_facts", {}) if faa else {}
    flags.append({
        "id": flag_id("faa_beyond_momentum"),
        "timestamp": TODAY,
        "flag_type": "regulatory",
        "severity": "warning",
        "category": "dfr",
        "title": f"FAA BEYOND: {kf.get('approved', '214+')} waivers approved, avg {kf.get('avg_days', 7)} days — Part 108 mid-2026",
        "detail": (
            f"FAA BEYOND program: {kf.get('approved', '214+')} waivers approved as of June 2025. "
            f"Average approval time: {kf.get('avg_days', 7)} days (down from 11+ months in 2024). "
            f"Fastest approval: {kf.get('fastest_hours', 2)} hours. 6× YoY DFR program growth. "
            "Required equipment: parachute system, anti-collision lighting, detect-and-avoid (DAA). "
            f"Part 108 national BVLOS framework expected {kf.get('part_108', 'mid-2026')}, replacing "
            "case-by-case waivers. Agencies that secure BEYOND waivers now will have operational "
            "experience advantage when Part 108 standardizes requirements."
        ),
        "confidence": 0.96,
        "prediction": "Part 108 finalization mid-2026 will trigger a new wave of DFR program launches "
                      "from agencies that were waiting for a national standard. Approval timeline "
                      "compression makes BEYOND waiver support a low-friction agency offer.",
        "data_sources": ["faa_gov"],
        "sources": [FAA_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "faa-beyond-waiver",
    })

    # ── 9. Grant Window — COPS Technology ────────────────────────────────────
    flags.append({
        "id": flag_id("grant_cops_technology"),
        "timestamp": TODAY,
        "flag_type": "procurement_spike",
        "severity": "warning",
        "category": "dfr",
        "title": "COPS Technology grant: $50K–$750K+ for DFR platforms — annual Q1-Q2 window",
        "detail": (
            "COPS Technology Program (DOJ) funds law enforcement technology including DFR drone systems "
            "under AEL item 03OE-07-SUAS. Awards range $50K–$750K+. Annual application window typically "
            "Q1-Q2. NDAA/ASDA compliance required — Blue UAS listing simplifies procurement. "
            "Sterling Heights MI PD received $678,822 in 2026. Grant covers platforms, docks, software, "
            "and training. Agencies can stack COPS with HSGP/SHSP for larger programs. "
            "No competitive bid required when using TIPS or Sourcewell cooperative purchasing vehicles."
        ),
        "confidence": 0.95,
        "prediction": "COPS Technology is the most accessible DFR grant for municipal LE agencies. "
                      "Wisconsin, Indiana, Nebraska agencies are eligible and likely unaware of "
                      "the transition pathway. Grant-ready agencies can move in 90 days.",
        "data_sources": ["dhs_fema", "dfr_master"],
        "sources": [DHS_SOURCE, DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "cops-technology-grant",
    })

    # ── 10. Platform Supply Gap ───────────────────────────────────────────────
    flags.append({
        "id": flag_id("ndaa_platform_supply_gap"),
        "timestamp": TODAY,
        "flag_type": "supply_constraint",
        "severity": "warning",
        "category": "dfr",
        "title": "NDAA-compliant DFR platforms: 2.8× cost premium, supply not scaled to replacement demand",
        "detail": (
            "Idaho NASAO benchmark: $15K DJI drone → $42K compliant replacement (2.8× premium). "
            "Key NDAA-compliant DFR platforms: Skydio X10D ($30-50K), BRINC Lemur 2/Guardian ($40-80K), "
            "Parrot ANAFI USA ($7-15K), ACSL SOTEN ($7-14K — most affordable). "
            "Dock-based DFR systems: Skydio Dock (~$80K), DJI Dock 2 (non-compliant), "
            "American Robotics Scout (agriculture-focused). "
            "467 grounded airframes nationally × $30K average replacement = $14M minimum market, "
            "likely $50M+ when including docks, software, training, and grant administration. "
            "Skydio and BRINC production not scaled to absorb simultaneous 25-state replacement demand."
        ),
        "confidence": 0.88,
        "prediction": "Skydio and BRINC lead times will extend to 3-6 months by Q3 2026 as replacement "
                      "demand accelerates. Agencies that delay procurement face both compliance gaps "
                      "and supply shortages simultaneously. ACSL SOTEN is the near-term pressure valve.",
        "data_sources": ["oregon_nasao", "dfr_master"],
        "sources": [NASAO_SOURCE, DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "dfr-platform-supply-gap",
    })

    # ── 11. FCC Conditional Approval signal ──────────────────────────────────
    flags.append({
        "id": flag_id("fcc_conditional_approval_dfr"),
        "timestamp": TODAY,
        "flag_type": "regulatory",
        "severity": "warning",
        "category": "dfr",
        "title": "FCC Conditional Approvals (Mar 2026): 4 drone systems approved through Dec 31 2026",
        "detail": (
            "FCC March 18 2026: first Conditional Approvals for drone systems — new compliance pathway "
            "alongside Blue UAS and Green UAS certification. 4 systems approved through Dec 31 2026. "
            "Conditional Approval is system-specific (not manufacturer-wide) and does NOT replace "
            "NDAA/ASDA requirements. Agencies on federal grants still require NDAA-compliant platforms. "
            "Grant eligibility matrices must be updated to reflect this pathway. "
            "All 4 approvals expire Dec 31 2026 — procurement decisions before that date carry risk "
            "if the conditional approval is not extended."
        ),
        "confidence": 0.99,
        "prediction": "FCC will evaluate extension of conditional approvals before Dec 31 2026. "
                      "Agencies procuring under conditional approval should plan for potential "
                      "re-authorization requirement. Do not treat as permanent compliance.",
        "data_sources": ["fcc_gov", "dfr_master"],
        "sources": [
            source("FCC Covered List", "https://www.fcc.gov/supplychain/coveredlist",
                   "FCC Covered List under Secure Equipment Act. Updated March 18 2026 with Conditional Approvals."),
            DFR_MASTER_SOURCE
        ],
        "platform_id": None,
        "component_id": None,
        "entity_id": "fcc-conditional-approval",
    })

    # ── 12. Ohio DFR Pilot — State Program Signal ─────────────────────────────
    flags.append({
        "id": flag_id("ohio_dfr_pilot_signal"),
        "timestamp": TODAY,
        "flag_type": "contract_signal",
        "severity": "warning",
        "category": "dfr",
        "title": "Ohio statewide DFR pilot (SkyfireAI/ODOT): first participants identified, $110-230K per site",
        "detail": (
            "Ohio identified first municipal participants in nation's only statewide DFR pilot. "
            "SkyfireAI managing under ODOT/DriveOhio. Pre-approved vendor list (closed Jan 1 2026): "
            "Skydio, BRINC, Parrot. Reimbursement model: agencies pay upfront, state reimburses. "
            "Typical package: $110,000–$230,000 per site. "
            "Texas, California, Florida, Michigan watching as template for statewide programs. "
            "This is the leading indicator for state-level DFR procurement standardization nationally."
        ),
        "confidence": 0.96,
        "prediction": "Ohio pilot will produce publishable outcomes by Q4 2026 that trigger 3-5 "
                      "additional states to launch similar programs in 2027. "
                      "Skydio and BRINC are the primary beneficiaries of the approved vendor list.",
        "data_sources": ["dfr_master"],
        "sources": [DFR_MASTER_SOURCE],
        "platform_id": None,
        "component_id": None,
        "entity_id": "ohio-dfr-pilot",
    })

    return flags


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if not DFR_MASTER.exists():
        print(f"[ERROR] DFR master not found: {DFR_MASTER}")
        return

    master = json.loads(DFR_MASTER.read_text())
    new_flags = build_flags(master)

    # Load existing flags, strip old DFR flags, merge new ones
    existing = json.loads(PIE_FLAGS.read_text()) if PIE_FLAGS.exists() else []
    non_dfr  = [f for f in existing if not f.get("id","").startswith("dfr_")]
    merged   = non_dfr + new_flags

    PIE_FLAGS.write_text(json.dumps(merged, indent=2))

    dfr_count = len(new_flags)
    total     = len(merged)
    print(f"[DONE] Generated {dfr_count} DFR flags → pie_flags.json ({total} total)")
    print()
    by_sev = {}
    for f in new_flags:
        s = f["severity"]
        by_sev[s] = by_sev.get(s, 0) + 1
    for s, c in sorted(by_sev.items()):
        print(f"  {s}: {c}")
    print()
    for f in new_flags:
        print(f"  [{f['severity']:8}] {f['title'][:70]}")


if __name__ == "__main__":
    main()
