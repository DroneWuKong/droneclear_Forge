#!/usr/bin/env python3
"""
Generate free-tier data slices for the public build.
Same data as paid tiers, just less of it.
Runs at build time — outputs to build/static/

Free tier shows enough to understand the value,
not enough to replace the subscription.
"""

import json, os, sys
from pathlib import Path

# Try to load from Ai-Project clone, local data/, or the static/ folder in the repo.
# At Netlify build time, pie_*.json are committed into static/ by the sync workflow.
# Set AI_PROJECT_DATA to override (e.g. for a local clone in a non-default location);
# previously this list hardcoded /home/claude/Ai-Project/data which is a developer
# machine path that silently degraded to a fallback in CI.
SEARCH_PATHS = [
    Path(p) for p in [
        os.environ.get('AI_PROJECT_DATA'),
        '../Ai-Project/data',
        'data',
        'DroneClear Components Visualizer/static',  # pie_flags.json, pie_predictions.json live here
    ] if p
]

def find_file(name):
    for base in SEARCH_PATHS:
        for path in [
            base / name,
            base / 'intel-db' / name,
            base / 'parts-db' / name,
        ]:
            if path.exists():
                return path
    return None

def load(name):
    p = find_file(name)
    if not p:
        print(f"  WARNING: {name} not found in search paths", file=sys.stderr)
        return None
    return json.loads(p.read_text())

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(',', ':')))
    size = len(path.read_text())
    print(f"  {path.name}: {size:,} bytes")

def main(args=None):
    if args and len(args) >= 1:
        out = Path(args[0])
    elif len(sys.argv) >= 2:
        out = Path(sys.argv[1])
    else:
        out = Path('build/static')

    print("Generating free-tier data slices...")

    # ── PIE BRIEF — headline + lead_story + signal counts ─────────────────
    brief = load('pie_brief.json')
    if brief:
        # Preserve signal_summary (counts are not sensitive — the count itself
        # communicates "something is happening" without exposing flag content).
        # Frontend renders signal bar from this; without it, counters show 0/0/0/0.
        free_brief = {
            'date':             brief.get('date'),
            'generated_at':     brief.get('generated_at'),
            'pipeline_version': brief.get('pipeline_version'),
            'headline':         brief.get('headline', ''),
            'signal_summary':   brief.get('signal_summary', {}),
            'delta_summary':    brief.get('delta_summary', ''),
            'fcc_countdown':    brief.get('fcc_countdown'),
            'lead_story':       brief.get('lead_story'),   # full lead story
            'flag_severities':  brief.get('flag_severities', {}),
            'flag_ids':         brief.get('flag_ids', []),  # full ordered list of featured flags
            # Gated sections — removed from free tier:
            # gray_zone, supply_chain, watch_list, predictions, intel_feed
            '_free_tier': True,
            '_upgrade_note': 'Commercial tier includes gray zone, supply chain, watch list, and full intel feed.',
        }
        write(out / 'pie_brief.json', free_brief)

    # ── PIE FLAGS — first 20, title + severity + type only ───────────────
    flags_raw = load('pie_flags.json')
    if flags_raw:
        flags = flags_raw if isinstance(flags_raw, list) else flags_raw.get('flags', [])
        # Sort by severity: critical first
        sev_order = {'critical': 0, 'warning': 1, 'info': 2}
        flags_sorted = sorted(flags, key=lambda f: sev_order.get(f.get('severity','info'), 3))
        FLAG_LIMIT = 20
        free_flags = []
        for f in flags_sorted[:FLAG_LIMIT]:
            free_flags.append({
                'id':        f.get('id'),
                'flag_type': f.get('flag_type'),
                'severity':  f.get('severity'),
                'title':     f.get('title'),
                'timestamp': f.get('timestamp'),
                # detail, prediction, sources, data_sources — gated
            })
        print(f"  pie_flags.json:    kept {len(free_flags)}/{len(flags)} (free-tier limit {FLAG_LIMIT}, dropped {max(0, len(flags) - FLAG_LIMIT)})")
        write(out / 'pie_flags.json', free_flags)
        # Also write a summary stub
        sev_counts = {}
        for f in flags:
            s = f.get('severity', 'unknown')
            sev_counts[s] = sev_counts.get(s, 0) + 1
        write(out / 'pie_flags_summary.json', {
            'total': len(flags),
            'by_severity': sev_counts,
            '_free_tier': True,
        })

    # ── PIE PREDICTIONS — first 3, event + timeframe + impact only ───────
    preds_raw = load('predictions.json') or load('pie_predictions.json')
    if preds_raw:
        preds = preds_raw if isinstance(preds_raw, list) else preds_raw.get('predictions', [])
        PRED_LIMIT = 3
        free_preds = []
        for p in preds[:PRED_LIMIT]:
            free_preds.append({
                'id':        p.get('id'),
                'timeframe': p.get('timeframe'),
                'event':     p.get('event'),
                'impact':    p.get('impact'),
                # probability, confidence, model_outputs, drivers — gated
            })
        print(f"  pie_predictions:   kept {len(free_preds)}/{len(preds)} (free-tier limit {PRED_LIMIT}, dropped {max(0, len(preds) - PRED_LIMIT)})")
        write(out / 'pie_predictions.json', free_preds)

    # ── PIE TRENDS — full (no sensitive content, just trend lines) ────────
    trends = load('pie_trends.json')
    if trends:
        write(out / 'pie_trends.json', trends)

    # ── PIE BRIEF HISTORY — last 7 days headlines only ───────────────────
    history = load('pie_brief_history.json')
    if history:
        briefs = history if isinstance(history, list) else history.get('briefs', [])
        BRIEF_LIMIT = 7
        free_history = []
        for b in briefs[-BRIEF_LIMIT:]:
            free_history.append({
                'date':     b.get('date'),
                'headline': b.get('headline', ''),
                'flag_severities': b.get('flag_severities', {}),
            })
        print(f"  pie_brief_history: kept {len(free_history)}/{len(briefs)} (free-tier limit {BRIEF_LIMIT}, dropped {max(0, len(briefs) - BRIEF_LIMIT)})")
        write(out / 'pie_brief_history.json', free_history)

    # ── ENTITY GRAPH — top 50 entities, no relationship details ──────────
    graph = load('entity_graph.json')
    if graph:
        entities = graph if isinstance(graph, list) else graph.get('entities', [])
        ENTITY_LIMIT = 50
        all_nodes = list(graph.get('nodes') or []) if isinstance(graph, dict) else list(entities or [])
        nodes = all_nodes[:ENTITY_LIMIT]
        # Strip sensitive fields
        free_nodes = []
        for n in nodes:
            free_nodes.append({k: v for k, v in n.items()
                if k not in ['sources', 'evidence', 'raw_score', 'methodology']})
        print(f"  entity_graph:      kept {len(free_nodes)}/{len(all_nodes)} nodes (free-tier limit {ENTITY_LIMIT}, dropped {max(0, len(all_nodes) - ENTITY_LIMIT)})")
        write(out / 'entity_graph.json', {'nodes': free_nodes, '_free_tier': True})

    # ── GAP ANALYSIS — full (no sensitive content) ───────────────────────
    gaps = load('gap_analysis_latest.json')
    if gaps:
        write(out / 'gap_analysis_latest.json', gaps)

    print(f"\nFree-tier slices written to {out}/")

if __name__ == '__main__':
    main()
