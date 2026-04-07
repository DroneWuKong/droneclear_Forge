#!/usr/bin/env python3
"""
generate_brief.py — Daily PIE Intelligence Brief Generator

Reads:
  - pie_flags.json           → current flag state
  - pie_brief.json           → yesterday's brief (for delta)
  - dfr_master.json          → live news from miners

Produces:
  - pie_brief.json           → rendered brief for UI
  - pie_brief_history.json   → rolling 7-day archive for delta tracking

Delta logic:
  - New flags (not in yesterday's flag_ids) → surfaced as "NEW"
  - Severity escalations (warning→critical) → surfaced as "ESCALATED"
  - Flags resolved since yesterday → noted as "RESOLVED"
  - Persistent flags → shown with "Day N" staleness counter

News injection:
  - Latest 5 records from dfr_master.json added as "Intelligence Feed"
  - Only records from past 7 days shown
  - Deduped against flag titles to avoid redundancy
"""

import json
import hashlib
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT         = Path(__file__).parent.parent.parent
FLAGS_PATH   = ROOT / "DroneClear Components Visualizer" / "pie_flags.json"
BRIEF_PATH   = ROOT / "DroneClear Components Visualizer" / "pie_brief.json"
HISTORY_PATH = ROOT / "DroneClear Components Visualizer" / "pie_brief_history.json"
DFR_MASTER   = ROOT / "data" / "dfr" / "dfr_master.json"

TODAY     = datetime.now(timezone.utc).strftime("%Y-%m-%d")
NOW       = datetime.now(timezone.utc).isoformat()
FCC_CLIFF = datetime(2027, 1, 1, tzinfo=timezone.utc)
DAYS_TO_FCC = (FCC_CLIFF - datetime.now(timezone.utc)).days


def load_json(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return default if default is not None else {}


def flag_priority(f):
    sev_score = {"critical": 3, "warning": 2, "info": 1}.get(f.get("severity","info"), 1)
    conf = float(f.get("confidence", 0.5))
    return sev_score * conf


def days_since(ts_str):
    """Return number of days since a timestamp string."""
    if not ts_str:
        return 0
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except Exception:
        return 0


def build_headline(flags, prev_ids, escalated_ids, new_count, resolved_count):
    """Generate a fresh headline that reflects the day's actual movement."""
    critical = [f for f in flags if f.get("severity") == "critical"]
    
    # Lead with the most newsworthy thing that changed
    if escalated_ids:
        esc_flag = next((f for f in flags if f["id"] in escalated_ids), None)
        if esc_flag:
            return f"ESCALATION: {esc_flag.get('title','').split('—')[0].strip()} — {esc_flag.get('detail','')[:120]}"
    
    if new_count > 0:
        new_flags = [f for f in flags if f["id"] not in prev_ids and f.get("severity") == "critical"]
        if new_flags:
            return f"{new_count} new flag{'s' if new_count > 1 else ''} today — {new_flags[0].get('title','')} leads critical signals. {DAYS_TO_FCC} days to FCC cliff."
    
    # Synthesize from top critical flags
    top = sorted(critical, key=flag_priority, reverse=True)[:2]
    if len(top) >= 2:
        t1 = top[0].get("title","").split("—")[0].strip()
        t2 = top[1].get("title","").split("—")[0].strip()
        return f"{t1} + {t2} — procurement officers sourcing Blue UAS thermal sensors face the highest near-term supply risk since 2024."
    elif top:
        return top[0].get("detail","")[:200]
    return f"PIE tracking {len(flags)} signals · {DAYS_TO_FCC} days to FCC Blue UAS exemption cliff."


def build_lead_story(flags, prev_flag_map, new_ids, escalated_ids):
    """Pick the lead story — prioritize escalated > new > highest confidence critical."""
    candidates = sorted(
        [f for f in flags if f.get("severity") == "critical"],
        key=flag_priority, reverse=True
    )
    
    # Prefer escalated or new
    for f in candidates:
        if f["id"] in escalated_ids or f["id"] in new_ids:
            return f, "escalated" if f["id"] in escalated_ids else "new"
    
    if candidates:
        return candidates[0], "persistent"
    return None, None


def delta_badge(flag_id, prev_flag_map, new_ids, escalated_ids, resolved_ids):
    """Return a delta badge string for a flag."""
    if flag_id in new_ids:
        return "🆕 NEW TODAY"
    if flag_id in escalated_ids:
        return "⬆ ESCALATED"
    ts = prev_flag_map.get(flag_id, {}).get("timestamp","")
    d = days_since(ts)
    if d >= 7:
        return f"Day {d} · persistent"
    if d >= 3:
        return f"Day {d}"
    return ""


def get_recent_news(dfr_master, existing_titles, limit=5):
    """Pull recent records from dfr_master that aren't redundant with flags."""
    records = dfr_master.get("records", [])
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).strftime("%Y-%m-%d")
    
    # Filter recent, non-empty, non-redundant
    existing_lower = {t.lower() for t in existing_titles}
    fresh = []
    for r in records:
        pub = r.get("pub_date","") or ""
        if pub < cutoff:
            continue
        title = r.get("title","")
        if not title or len(title) < 10:
            continue
        # Skip if too similar to existing flag titles
        if any(word in title.lower() for word in ["test", "sample", "unknown"]):
            continue
        if any(word in existing_lower for word in title.lower().split() if len(word) > 6):
            continue
        fresh.append(r)
    
    # Sort by date desc
    fresh.sort(key=lambda r: r.get("pub_date",""), reverse=True)
    
    return fresh[:limit]


def generate_brief():
    flags     = load_json(FLAGS_PATH, [])
    prev_brief = load_json(BRIEF_PATH, {})
    history   = load_json(HISTORY_PATH, {"days": []})
    dfr_master = load_json(DFR_MASTER, {"records": []})

    if not flags:
        print("[WARN] No flags found — writing minimal brief")
        flags = []

    # ── Delta computation ──────────────────────────────────────────────────────
    prev_flag_ids  = set(prev_brief.get("flag_ids", []))
    prev_severities = prev_brief.get("flag_severities", {})
    prev_flag_map  = {f["id"]: f for f in flags}  # current flags by id

    current_flag_ids = {f["id"] for f in flags}
    
    new_ids       = current_flag_ids - prev_flag_ids
    resolved_ids  = prev_flag_ids - current_flag_ids
    escalated_ids = {
        f["id"] for f in flags
        if f["id"] in prev_flag_ids
        and prev_severities.get(f["id"]) == "warning"
        and f.get("severity") == "critical"
    }
    
    new_count      = len(new_ids)
    resolved_count = len(resolved_ids)

    # ── Signal summary ─────────────────────────────────────────────────────────
    sev_counts = Counter(f.get("severity","info") for f in flags)
    signal_summary = {
        "critical":    sev_counts.get("critical", 0),
        "warning":     sev_counts.get("warning", 0),
        "new_today":   new_count,
        "resolved":    resolved_count,
        "escalated":   len(escalated_ids),
        "total_flags": len(flags),
        "fcc_days_remaining": DAYS_TO_FCC,
        "top_concern": None,
    }
    
    # Top concern — most urgent new or escalated, else top critical
    urgent = [f for f in flags if f["id"] in (new_ids | escalated_ids) and f.get("severity") == "critical"]
    top_concern_flag = (sorted(urgent, key=flag_priority, reverse=True) or
                        sorted([f for f in flags if f.get("severity")=="critical"], key=flag_priority, reverse=True))
    if top_concern_flag:
        t = top_concern_flag[0]
        badge = "🆕 " if t["id"] in new_ids else "⬆ " if t["id"] in escalated_ids else ""
        days_str = f" · persistent {days_since(t.get('timestamp',''))}d" if t["id"] not in new_ids and days_since(t.get('timestamp','')) >= 3 else ""
        signal_summary["top_concern"] = f"{badge}{t.get('title','').split('—')[0].strip()}{days_str}"

    # ── Headline ───────────────────────────────────────────────────────────────
    headline = build_headline(flags, prev_flag_ids, escalated_ids, new_count, resolved_count)

    # ── Lead story ─────────────────────────────────────────────────────────────
    lead_flag, lead_reason = build_lead_story(flags, prev_flag_map, new_ids, escalated_ids)
    lead_story = {}
    if lead_flag:
        d_badge = delta_badge(lead_flag["id"], prev_flag_map, new_ids, escalated_ids, resolved_ids)
        persistence = days_since(lead_flag.get("timestamp",""))
        lead_story = {
            "title": lead_flag.get("title",""),
            "body":  lead_flag.get("detail",""),
            "delta_badge": d_badge,
            "persistence_days": persistence,
            "reason": lead_reason,
            "action": (
                f"This flag has been active for {persistence} days. "
                if persistence >= 3 else ""
            ) + (lead_flag.get("sources",[{}])[0].get("description","") if lead_flag.get("sources") else ""),
            "sources": lead_flag.get("sources",[]),
        }

    # ── Gray zone ──────────────────────────────────────────────────────────────
    gz_flags = sorted(
        [f for f in flags if f.get("flag_type") == "grayzone"],
        key=flag_priority, reverse=True
    )[:3]
    gray_zone = []
    for f in gz_flags:
        d_badge = delta_badge(f["id"], prev_flag_map, new_ids, escalated_ids, resolved_ids)
        gray_zone.append({
            "entity":      f.get("platform_id","") or f.get("title","").split("—")[0].strip(),
            "status":      f.get("severity","").upper(),
            "development": f.get("detail",""),
            "delta_badge": d_badge,
            "persistence_days": days_since(f.get("timestamp","")),
            "buyer_exposure": f.get("prediction",""),
            "action":      f.get("sources",[{}])[0].get("description","") if f.get("sources") else "",
            "sources":     f.get("sources",[]),
        })

    # ── Supply chain ───────────────────────────────────────────────────────────
    sc_flags = sorted(
        [f for f in flags if f.get("flag_type") in ("supply_constraint","component_analysis","diversion_risk")],
        key=flag_priority, reverse=True
    )[:4]
    supply_chain = []
    for f in sc_flags:
        d_badge = delta_badge(f["id"], prev_flag_map, new_ids, escalated_ids, resolved_ids)
        supply_chain.append({
            "component":  f.get("component_id","") or f.get("title","").split("—")[0].strip(),
            "signal":     f.get("detail",""),
            "delta_badge": d_badge,
            "persistence_days": days_since(f.get("timestamp","")),
            "window":     f.get("prediction","")[:80] if f.get("prediction") else "",
            "action":     f.get("sources",[{}])[0].get("description","") if f.get("sources") else "",
            "sources":    f.get("sources",[]),
        })

    # ── Watch list ─────────────────────────────────────────────────────────────
    watch_flags = sorted(
        [f for f in flags if f.get("severity") == "warning" and f.get("flag_type") == "contract_signal"],
        key=flag_priority, reverse=True
    )[:4]
    watch_list = []
    for f in watch_flags:
        d_badge = delta_badge(f["id"], prev_flag_map, new_ids, escalated_ids, resolved_ids)
        watch_list.append({
            "item":    f.get("title",""),
            "why":     f.get("detail","")[:120],
            "delta_badge": d_badge,
            "trigger": f.get("prediction","")[:100] if f.get("prediction") else "",
        })

    # ── Predictions ────────────────────────────────────────────────────────────
    pred_flags = sorted(
        [f for f in flags if f.get("prediction") and float(f.get("confidence",0)) >= 0.55],
        key=lambda f: float(f.get("confidence",0)), reverse=True
    )[:4]
    predictions = []
    for f in pred_flags:
        conf = float(f.get("confidence", 0.5))
        predictions.append({
            "event":       f.get("title",""),
            "probability": conf,
            "timeframe":   "30-60 days" if conf >= 0.7 else "60-90 days",
            "hedge":       f.get("prediction","")[:140] if f.get("prediction") else "",
        })

    # ── FCC countdown (always-fresh section) ──────────────────────────────────
    fcc_section = {
        "days_remaining": DAYS_TO_FCC,
        "pct_elapsed":    round((1 - DAYS_TO_FCC / 365) * 100, 1),
        "status": "critical" if DAYS_TO_FCC < 90 else "warning" if DAYS_TO_FCC < 180 else "watch",
        "message": (
            f"{DAYS_TO_FCC} days until FCC Blue UAS exemption expires (Jan 1, 2027). "
            f"Agencies running DJI/Autel under exemption must complete platform transition or secure individual exemption."
        ),
    }

    # ── Recent intelligence (news injection) ──────────────────────────────────
    existing_titles = [f.get("title","") for f in flags[:20]]
    recent_news = get_recent_news(dfr_master, existing_titles, limit=5)
    intel_feed = [
        {
            "title":   r.get("title",""),
            "source":  r.get("source",""),
            "url":     r.get("url",""),
            "pub_date": r.get("pub_date",""),
            "summary": (r.get("summary","") or "")[:200],
            "category": r.get("data_category","market_signal"),
        }
        for r in recent_news
        if r.get("title") and r.get("pub_date","") >= (
            datetime.now(timezone.utc) - timedelta(days=14)
        ).strftime("%Y-%m-%d")
    ]

    # ── Delta summary for top of brief ────────────────────────────────────────
    delta_summary = {
        "new_flags":       new_count,
        "resolved_flags":  resolved_count,
        "escalated_flags": len(escalated_ids),
        "vs_yesterday":    (
            f"+{new_count} new" if new_count else "No new flags"
        ) + (
            f", {len(escalated_ids)} escalated" if escalated_ids else ""
        ) + (
            f", {resolved_count} resolved" if resolved_count else ""
        ),
        "new_flag_titles": [
            f.get("title","") for f in flags
            if f["id"] in new_ids
        ][:3],
    }

    # ── Resolved flags note ────────────────────────────────────────────────────
    resolved_note = None
    if resolved_count > 0:
        resolved_note = f"{resolved_count} flag{'s' if resolved_count>1 else ''} resolved since yesterday."

    # ── Build brief ────────────────────────────────────────────────────────────
    brief = {
        "date":           TODAY,
        "generated_at":   NOW,
        "pipeline_version": f"PIE v0.8 · {TODAY}",
        "headline":       headline,
        "delta_summary":  delta_summary,
        "signal_summary": signal_summary,
        "fcc_countdown":  fcc_section,
        "lead_story":     lead_story,
        "gray_zone":      gray_zone,
        "supply_chain":   supply_chain,
        "watch_list":     watch_list,
        "predictions":    predictions,
        "intel_feed":     intel_feed,
        "resolved_note":  resolved_note,
        "flag_ids":       list(current_flag_ids),
        "flag_severities": {f["id"]: f.get("severity","info") for f in flags},
    }

    # ── Write brief ────────────────────────────────────────────────────────────
    BRIEF_PATH.write_text(json.dumps(brief, indent=2))
    print(f"[DONE] pie_brief.json written — {len(flags)} flags, {new_count} new, {len(escalated_ids)} escalated, {len(intel_feed)} news items")

    # ── Update history (keep 7 days) ──────────────────────────────────────────
    days = history.get("days", [])
    days = [d for d in days if d.get("date","") >= (
        datetime.now(timezone.utc) - timedelta(days=7)
    ).strftime("%Y-%m-%d")]
    days.append({
        "date":        TODAY,
        "critical":    signal_summary["critical"],
        "warning":     signal_summary["warning"],
        "total":       signal_summary["total_flags"],
        "new":         new_count,
        "escalated":   len(escalated_ids),
        "resolved":    resolved_count,
        "flag_ids":    list(current_flag_ids),
        "flag_severities": {f["id"]: f.get("severity","info") for f in flags},
    })
    HISTORY_PATH.write_text(json.dumps({"days": days}, indent=2))
    print(f"[DONE] pie_brief_history.json updated — {len(days)} days archived")


if __name__ == "__main__":
    generate_brief()
