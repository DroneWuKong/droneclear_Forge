"""
L-04 | DFR Mission Type → Platform Recommendation Engine
Given a mission type (and optional constraints), returns ranked platform
recommendations with grant eligibility, CAD integration, and rationale.

Usage:
  python scripts/dfr/mission_recommender.py --mission patrol
  python scripts/dfr/mission_recommender.py --mission sar --state OH
  python scripts/dfr/mission_recommender.py --mission indoor_tactical --grant cops_tech
  python scripts/dfr/mission_recommender.py --list-missions
  python scripts/dfr/mission_recommender.py --report --agency "Springfield PD" --state IL --missions patrol sar
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

PLATFORMS_PATH = Path("data/dfr/platforms/dfr_platforms_v1.json")
GRANT_MATRIX_PATH = Path("data/dfr/grant_eligibility_matrix.json")
CAD_MATRIX_PATH = Path("data/dfr/cad_integration_matrix.json")

# Mission definitions: requirements, scoring weights, and notes
MISSIONS = {
    "patrol": {
        "label": "Patrol / Crime Response",
        "description": "Real-time aerial coverage of 911 calls — pursuit, active scenes, suspect location",
        "required": {
            "outdoor": True,
            "bvlos_capable": True,
            "speed_min_mph": 40,
            "flight_time_min": 30,
            "cad_integration": True,
        },
        "preferred": {
            "alpr": True,
            "auto_dispatch": True,
            "night_capable": True,
        },
        "scoring_weights": {
            "speed": 0.25,
            "cad_integration": 0.30,
            "auto_dispatch": 0.20,
            "flight_time": 0.15,
            "grant_friction": 0.10,
        },
        "top_cad_systems": ["axon_evidence", "fusus_rtcc", "flock911", "motorola_premierone"],
    },
    "structure_fire_recon": {
        "label": "Structure Fire Reconnaissance",
        "description": "Pre-arrival scene assessment, hotspot detection, roof condition, access points",
        "required": {
            "outdoor": True,
            "thermal_capable": True,
            "bvlos_capable": True,
            "flight_time_min": 25,
        },
        "preferred": {
            "night_capable": True,
            "gis_integration": True,
        },
        "scoring_weights": {
            "thermal": 0.35,
            "flight_time": 0.25,
            "gis_integration": 0.20,
            "grant_friction": 0.10,
            "speed": 0.10,
        },
        "top_cad_systems": ["esri_site_scan", "dronesense", "fusus_rtcc"],
    },
    "sar": {
        "label": "Search and Rescue",
        "description": "Wilderness or urban SAR — locate missing persons, disaster victims, subjects in GPS-denied terrain",
        "required": {
            "outdoor": True,
            "thermal_capable": True,
            "bvlos_capable": True,
            "flight_time_min": 30,
        },
        "preferred": {
            "gps_denied_capable": True,
            "zoom_optical": True,
            "night_capable": True,
            "heavy_lift": False,
        },
        "scoring_weights": {
            "thermal": 0.30,
            "flight_time": 0.25,
            "zoom": 0.20,
            "gps_denied": 0.15,
            "grant_friction": 0.10,
        },
        "top_cad_systems": ["esri_site_scan", "dronesense"],
    },
    "traffic_incident": {
        "label": "Traffic Incident / Accident Reconstruction",
        "description": "Scene documentation, traffic management, aerial mapping for reconstruction",
        "required": {
            "outdoor": True,
            "bvlos_capable": True,
            "high_resolution_camera": True,
        },
        "preferred": {
            "gis_integration": True,
            "mapping_capable": True,
        },
        "scoring_weights": {
            "image_quality": 0.30,
            "gis_integration": 0.30,
            "flight_time": 0.20,
            "grant_friction": 0.10,
            "speed": 0.10,
        },
        "top_cad_systems": ["esri_site_scan", "dronesense"],
    },
    "crowd_monitoring": {
        "label": "Crowd Monitoring / Large Event",
        "description": "Aerial oversight of large public gatherings, protests, sporting events",
        "required": {
            "outdoor": True,
            "bvlos_capable": True,
            "flight_time_min": 35,
            "night_capable": True,
        },
        "preferred": {
            "zoom_optical": True,
            "rtcc_integration": True,
        },
        "scoring_weights": {
            "flight_time": 0.30,
            "zoom": 0.25,
            "rtcc_integration": 0.25,
            "grant_friction": 0.10,
            "speed": 0.10,
        },
        "top_cad_systems": ["fusus_rtcc", "dronesense", "axon_evidence"],
    },
    "indoor_tactical": {
        "label": "Indoor Tactical / SWAT",
        "description": "GPS-denied indoor environments — barricades, active shooter inside structure, pre-entry reconnaissance",
        "required": {
            "indoor": True,
            "gps_denied_capable": True,
            "collision_tolerant": True,
        },
        "preferred": {
            "two_way_audio": True,
            "thermal_capable": True,
            "glass_breaker": True,
        },
        "scoring_weights": {
            "gps_denied": 0.35,
            "collision_tolerant": 0.30,
            "two_way_audio": 0.20,
            "grant_friction": 0.15,
        },
        "top_cad_systems": [],
        "note": "Only one platform class supports this mission type: BRINC Lemur 2. Outdoor DFR platforms are not suitable for indoor tactical use.",
    },
    "aed_delivery": {
        "label": "Emergency Payload Delivery (AED/Narcan)",
        "description": "Deliver AED, naloxone, or other emergency payload before ambulance arrival",
        "required": {
            "outdoor": True,
            "bvlos_capable": True,
            "payload_delivery": True,
            "speed_min_mph": 40,
        },
        "preferred": {
            "winch_system": True,
            "flight_time_min": 30,
        },
        "scoring_weights": {
            "speed": 0.30,
            "payload_delivery": 0.30,
            "flight_time": 0.20,
            "grant_friction": 0.20,
        },
        "top_cad_systems": ["dronesense"],
        "note": "Emerging use case — limited platform support. Verify payload delivery capability with manufacturer before procurement.",
    },
}

# Platform capability profiles (derived from platforms DB)
PLATFORM_PROFILES = {
    "skydio_x10d": {
        "name": "Skydio X10D",
        "outdoor": True, "indoor": False,
        "speed_mph": 45, "flight_time_min": 40,
        "thermal_capable": True, "night_capable": True,
        "gps_denied_capable": True, "bvlos_capable": True,
        "collision_tolerant": False, "two_way_audio": False,
        "glass_breaker": False, "alpr": False, "auto_dispatch": False,
        "zoom_optical": True, "high_resolution_camera": True,
        "payload_delivery": False, "mapping_capable": True,
        "cad_integrations": ["axon_evidence", "fusus_rtcc", "esri_site_scan", "dronesense"],
        "grant_friction": "low", "blue_uas": True, "ndaa": True,
    },
    "skydio_r10": {
        "name": "Skydio R10",
        "outdoor": True, "indoor": False,
        "speed_mph": 45, "flight_time_min": 35,
        "thermal_capable": True, "night_capable": True,
        "gps_denied_capable": True, "bvlos_capable": True,
        "collision_tolerant": False, "two_way_audio": False,
        "glass_breaker": False, "alpr": False, "auto_dispatch": False,
        "zoom_optical": True, "high_resolution_camera": True,
        "payload_delivery": False, "mapping_capable": True,
        "cad_integrations": ["axon_evidence", "fusus_rtcc", "esri_site_scan", "motorola_premierone", "dronesense"],
        "grant_friction": "low", "blue_uas": True, "ndaa": True,
        "dfr_native": True,
    },
    "flock_alpha": {
        "name": "Flock Alpha",
        "outdoor": True, "indoor": False,
        "speed_mph": 60, "flight_time_min": 45,
        "thermal_capable": True, "night_capable": True,
        "gps_denied_capable": False, "bvlos_capable": True,
        "collision_tolerant": False, "two_way_audio": False,
        "glass_breaker": False, "alpr": True, "auto_dispatch": True,
        "zoom_optical": False, "high_resolution_camera": True,
        "payload_delivery": False, "mapping_capable": False,
        "cad_integrations": ["flock911", "motorola_premierone"],
        "grant_friction": "medium", "blue_uas": False, "ndaa": True,
    },
    "brinc_lemur2": {
        "name": "BRINC Lemur 2",
        "outdoor": False, "indoor": True,
        "speed_mph": 20, "flight_time_min": 20,
        "thermal_capable": True, "night_capable": True,
        "gps_denied_capable": True, "bvlos_capable": False,
        "collision_tolerant": True, "two_way_audio": True,
        "glass_breaker": True, "alpr": False, "auto_dispatch": False,
        "zoom_optical": False, "high_resolution_camera": True,
        "payload_delivery": False, "mapping_capable": False,
        "cad_integrations": [],
        "grant_friction": "low", "blue_uas": True, "ndaa": True,
    },
    "parrot_anafi_usa": {
        "name": "Parrot ANAFI USA",
        "outdoor": True, "indoor": False,
        "speed_mph": 35, "flight_time_min": 32,
        "thermal_capable": True, "night_capable": False,
        "gps_denied_capable": False, "bvlos_capable": True,
        "collision_tolerant": False, "two_way_audio": False,
        "glass_breaker": False, "alpr": False, "auto_dispatch": False,
        "zoom_optical": True, "high_resolution_camera": True,
        "payload_delivery": False, "mapping_capable": True,
        "cad_integrations": ["dronesense"],
        "grant_friction": "medium", "blue_uas": True, "ndaa": True,
        "foci_note": "French parent company — verify FOCI disclosure with SAA"
    },
    "inspired_flight_if800": {
        "name": "Inspired Flight IF800",
        "outdoor": True, "indoor": False,
        "speed_mph": 40, "flight_time_min": 35,
        "thermal_capable": True, "night_capable": True,
        "gps_denied_capable": False, "bvlos_capable": True,
        "collision_tolerant": False, "two_way_audio": False,
        "glass_breaker": False, "alpr": False, "auto_dispatch": False,
        "zoom_optical": False, "high_resolution_camera": True,
        "payload_delivery": False, "mapping_capable": True,
        "cad_integrations": ["dronesense"],
        "grant_friction": "low", "blue_uas": True, "ndaa": True,
        "supply_note": "Production capacity constrained — verify lead times"
    },
}


def score_platform(platform_id: str, profile: dict, mission: dict, grant_filter: str = None) -> dict:
    mission_reqs = mission.get("required", {})
    mission_pref = mission.get("preferred", {})
    weights = mission.get("scoring_weights", {})

    # Hard requirement check
    fails = []
    if mission_reqs.get("outdoor") and not profile.get("outdoor"):
        fails.append("requires outdoor platform")
    if mission_reqs.get("indoor") and not profile.get("indoor"):
        fails.append("requires indoor platform")
    if mission_reqs.get("bvlos_capable") and not profile.get("bvlos_capable"):
        fails.append("requires BVLOS capability")
    if mission_reqs.get("thermal_capable") and not profile.get("thermal_capable"):
        fails.append("requires thermal sensor")
    if mission_reqs.get("collision_tolerant") and not profile.get("collision_tolerant"):
        fails.append("requires collision-tolerant frame")
    if mission_reqs.get("gps_denied_capable") and not profile.get("gps_denied_capable"):
        fails.append("requires GPS-denied capability")
    speed_min = mission_reqs.get("speed_min_mph", 0)
    if speed_min and profile.get("speed_mph", 0) < speed_min:
        fails.append(f"speed {profile.get('speed_mph')}mph below requirement {speed_min}mph")
    flight_min = mission_reqs.get("flight_time_min", 0)
    if flight_min and profile.get("flight_time_min", 0) < flight_min:
        fails.append(f"flight time {profile.get('flight_time_min')}min below requirement {flight_min}min")
    if mission_reqs.get("payload_delivery") and not profile.get("payload_delivery"):
        fails.append("requires payload delivery system")
    if mission_reqs.get("cad_integration") and not profile.get("cad_integrations"):
        fails.append("requires CAD integration")

    if fails:
        return {"platform_id": platform_id, "name": profile["name"], "eligible": False, "disqualified_reasons": fails, "score": 0}

    # Soft scoring
    score = 0.0
    score_breakdown = {}

    # Speed
    w = weights.get("speed", 0)
    spd = min(profile.get("speed_mph", 30) / 60.0, 1.0)
    score += w * spd
    score_breakdown["speed"] = round(w * spd, 3)

    # Flight time
    w = weights.get("flight_time", 0)
    ft = min(profile.get("flight_time_min", 20) / 45.0, 1.0)
    score += w * ft
    score_breakdown["flight_time"] = round(w * ft, 3)

    # Thermal
    w = weights.get("thermal", 0)
    t = 1.0 if profile.get("thermal_capable") else 0.0
    score += w * t
    score_breakdown["thermal"] = round(w * t, 3)

    # CAD integration
    w = weights.get("cad_integration", 0)
    top_cad = mission.get("top_cad_systems", [])
    cad_match = len([c for c in profile.get("cad_integrations", []) if c in top_cad])
    cad_score = min(cad_match / max(len(top_cad), 1), 1.0)
    score += w * cad_score
    score_breakdown["cad_integration"] = round(w * cad_score, 3)

    # Auto dispatch
    w = weights.get("auto_dispatch", 0)
    ad = 1.0 if profile.get("auto_dispatch") else 0.0
    score += w * ad
    score_breakdown["auto_dispatch"] = round(w * ad, 3)

    # Zoom
    w = weights.get("zoom", 0)
    z = 1.0 if profile.get("zoom_optical") else 0.0
    score += w * z
    score_breakdown["zoom"] = round(w * z, 3)

    # GIS integration
    w = weights.get("gis_integration", 0)
    gis = 1.0 if "esri_site_scan" in profile.get("cad_integrations", []) else 0.0
    score += w * gis
    score_breakdown["gis_integration"] = round(w * gis, 3)

    # RTCC integration
    w = weights.get("rtcc_integration", 0)
    rtcc = 1.0 if "fusus_rtcc" in profile.get("cad_integrations", []) else 0.0
    score += w * rtcc
    score_breakdown["rtcc_integration"] = round(w * rtcc, 3)

    # GPS-denied
    w = weights.get("gps_denied", 0)
    gpsd = 1.0 if profile.get("gps_denied_capable") else 0.0
    score += w * gpsd
    score_breakdown["gps_denied"] = round(w * gpsd, 3)

    # Collision tolerant
    w = weights.get("collision_tolerant", 0)
    ct = 1.0 if profile.get("collision_tolerant") else 0.0
    score += w * ct
    score_breakdown["collision_tolerant"] = round(w * ct, 3)

    # Two-way audio
    w = weights.get("two_way_audio", 0)
    twa = 1.0 if profile.get("two_way_audio") else 0.0
    score += w * twa
    score_breakdown["two_way_audio"] = round(w * twa, 3)

    # Grant friction (lower = better)
    w = weights.get("grant_friction", 0)
    friction_map = {"low": 1.0, "medium": 0.5, "high": 0.0}
    gf = friction_map.get(profile.get("grant_friction", "medium"), 0.5)
    score += w * gf
    score_breakdown["grant_friction"] = round(w * gf, 3)

    # Preferred attribute bonuses (+5% each, not weighted)
    bonuses = []
    for attr, val in mission_pref.items():
        if val and profile.get(attr):
            score += 0.03
            bonuses.append(attr)

    return {
        "platform_id": platform_id,
        "name": profile["name"],
        "eligible": True,
        "score": round(score, 3),
        "score_breakdown": score_breakdown,
        "preferred_bonuses": bonuses,
        "ndaa_compliant": profile.get("ndaa"),
        "blue_uas_listed": profile.get("blue_uas"),
        "grant_friction": profile.get("grant_friction"),
        "cad_integrations": profile.get("cad_integrations", []),
        "warnings": [v for k, v in {
            "foci": profile.get("foci_note"),
            "supply": profile.get("supply_note"),
        }.items() if v],
    }


def recommend(mission_id: str, grant_filter: str = None, state: str = None) -> list[dict]:
    if mission_id not in MISSIONS:
        raise ValueError(f"Unknown mission: {mission_id}. Use --list-missions to see options.")
    mission = MISSIONS[mission_id]
    results = []
    for pid, profile in PLATFORM_PROFILES.items():
        result = score_platform(pid, profile, mission, grant_filter)
        results.append(result)
    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def print_recommendation(mission_id: str, results: list[dict], agency: str = None):
    mission = MISSIONS[mission_id]
    print(f"\n{'='*60}")
    print(f"DFR Platform Recommendation")
    if agency:
        print(f"Agency: {agency}")
    print(f"Mission: {mission['label']}")
    print(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d')}")
    print(f"{'='*60}\n")

    eligible = [r for r in results if r["eligible"]]
    ineligible = [r for r in results if not r["eligible"]]

    print(f"RECOMMENDED PLATFORMS ({len(eligible)} eligible)\n")
    for i, r in enumerate(eligible, 1):
        stars = "★" * round(r["score"] * 5)
        blue = "✓ Blue UAS" if r["blue_uas_listed"] else "✗ Not Blue UAS"
        friction = r["grant_friction"].upper()
        print(f"  #{i}  {r['name']}")
        print(f"       Score: {r['score']:.2f}/1.00  {stars}")
        print(f"       {blue}  |  NDAA: {'✓' if r['ndaa_compliant'] else '✗'}  |  Grant friction: {friction}")
        if r.get("cad_integrations"):
            print(f"       CAD: {', '.join(r['cad_integrations'])}")
        if r.get("warnings"):
            for w in r["warnings"]:
                print(f"       ⚠ {w}")
        print()

    if ineligible:
        print(f"DISQUALIFIED PLATFORMS ({len(ineligible)})")
        for r in ineligible:
            print(f"  ✗  {r['name']}: {'; '.join(r['disqualified_reasons'])}")
    print()

    if mission.get("note"):
        print(f"NOTE: {mission['note']}\n")

    print(f"Top CAD integrations for this mission: {', '.join(mission.get('top_cad_systems', ['N/A']))}")
    print()


def generate_report(agency: str, state: str, missions: list[str]) -> dict:
    report = {
        "report_type": "DFR Platform Recommendation",
        "agency": agency,
        "state": state,
        "generated": datetime.now(timezone.utc).isoformat(),
        "missions": {},
    }
    for mission_id in missions:
        if mission_id not in MISSIONS:
            continue
        results = recommend(mission_id)
        report["missions"][mission_id] = {
            "label": MISSIONS[mission_id]["label"],
            "top_recommendation": next((r for r in results if r["eligible"]), None),
            "all_results": results,
        }
    return report


def main():
    parser = argparse.ArgumentParser(description="DFR Mission → Platform Recommender")
    parser.add_argument("--mission", help="Mission type ID")
    parser.add_argument("--list-missions", action="store_true", help="List all mission types")
    parser.add_argument("--grant", help="Filter by grant program ID")
    parser.add_argument("--state", help="State code (e.g. IL, OH, TX)")
    parser.add_argument("--agency", help="Agency name for report header")
    parser.add_argument("--missions", nargs="+", help="Multiple missions for full report")
    parser.add_argument("--report", action="store_true", help="Generate JSON report")
    parser.add_argument("--output", help="Output JSON path for report")
    args = parser.parse_args()

    if args.list_missions:
        print("\nAvailable mission types:")
        for mid, m in MISSIONS.items():
            print(f"  {mid:<25} {m['label']}")
        return

    if args.report and args.missions:
        report = generate_report(
            agency=args.agency or "Unknown Agency",
            state=args.state or "Unknown",
            missions=args.missions,
        )
        if args.output:
            Path(args.output).write_text(json.dumps(report, indent=2))
            print(f"Report written to {args.output}")
        else:
            print(json.dumps(report, indent=2))
        return

    if args.mission:
        results = recommend(args.mission, grant_filter=args.grant, state=args.state)
        print_recommendation(args.mission, results, agency=args.agency)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
