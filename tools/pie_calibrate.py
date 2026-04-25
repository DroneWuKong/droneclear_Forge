#!/usr/bin/env python3
"""
PIE Calibration Scorer
======================
Scores resolved predictions using Brier score and tracks calibration
over time. Run after each cohort deadline passes.

Usage:
  python3 tools/pie_calibrate.py                        # status check
  python3 tools/pie_calibrate.py --score                # score all resolved+was_correct predictions
  python3 tools/pie_calibrate.py --mark <id> --correct  # mark a prediction correct
  python3 tools/pie_calibrate.py --mark <id> --wrong    # mark a prediction wrong
  python3 tools/pie_calibrate.py --mark <id> --partial  # mark as partial (0.5)
  python3 tools/pie_calibrate.py --report               # full calibration report
"""

import json
import argparse
import math
import statistics
from datetime import datetime, timezone
from pathlib import Path
from collections import defaultdict, Counter

PREDS_PATH = Path(__file__).parent.parent / "DroneClear Components Visualizer" / "pie_predictions.json"
CALIBRATION_LOG_PATH = Path(__file__).parent.parent / "data" / "pie_calibration_log.json"


def load_preds():
    data = json.loads(PREDS_PATH.read_text())
    return data if isinstance(data, list) else list(data.values())


def save_preds(pred_list):
    PREDS_PATH.write_text(json.dumps(pred_list, indent=2, default=str))
    print(f"Saved {len(pred_list)} predictions to {PREDS_PATH.name}")


def brier_score(probability: float, outcome: float) -> float:
    """Brier score for a single prediction. Lower is better. Perfect = 0.0, worst = 1.0."""
    return (probability - outcome) ** 2


def outcome_to_float(was_correct, resolution_outcome=None) -> float | None:
    """Convert was_correct + resolution_outcome to a numeric outcome (0/0.5/1)."""
    if was_correct is True:
        return 1.0
    if was_correct is False:
        return 0.0
    if resolution_outcome == "partial":
        return 0.5
    return None


def cmd_status(pred_list):
    today = datetime.now(timezone.utc).date()
    total = len(pred_list)
    resolved = [p for p in pred_list if p.get("resolved")]
    unresolved = [p for p in pred_list if not p.get("resolved")]
    scoreable = [p for p in resolved if p.get("was_correct") is not None or p.get("resolution_outcome") == "partial"]
    needs_scoring = [p for p in resolved if p.get("was_correct") is None and p.get("resolution_outcome") != "partial"]
    expired_unscored = [p for p in needs_scoring if p.get("resolution_outcome") == "expired"]

    print(f"\n{'='*60}")
    print(f"PIE CALIBRATION STATUS — {today}")
    print(f"{'='*60}")
    print(f"Total predictions:      {total}")
    print(f"Resolved:               {len(resolved)}")
    print(f"  ├─ Scoreable:         {len(scoreable)}")
    print(f"  └─ Needs scoring:     {len(needs_scoring)}")
    print(f"     └─ Auto-expired:   {len(expired_unscored)}  ← pipeline marked expired, no evidence found")
    print(f"Active (unresolved):    {len(unresolved)}")

    # Deadline buckets
    buckets = defaultdict(list)
    for p in unresolved:
        td = (p.get("target_date") or "unknown")[:7]
        buckets[td].append(p)
    print(f"\nUpcoming deadlines:")
    for bucket in sorted(buckets):
        cohort = buckets[bucket]
        print(f"  {bucket}: {len(cohort)} predictions")

    # Outcome breakdown
    outcomes = Counter(p.get("resolution_outcome") for p in resolved)
    print(f"\nResolution outcomes:")
    for k, v in outcomes.most_common():
        print(f"  {k or 'null'}: {v}")

    # Quick Brier if any scored
    scored = [p for p in pred_list if outcome_to_float(p.get("was_correct"), p.get("resolution_outcome")) is not None]
    if scored:
        scores = [brier_score(p["probability"], outcome_to_float(p.get("was_correct"), p.get("resolution_outcome"))) for p in scored]
        print(f"\nCalibration (n={len(scored)}):")
        print(f"  Mean Brier score:  {statistics.mean(scores):.4f}  (0=perfect, 1=worst, random=0.25)")
        print(f"  Best:              {min(scores):.4f}")
        print(f"  Worst:             {max(scores):.4f}")
    else:
        print(f"\nNo scored predictions yet — run --mark to score resolved predictions.")

    # Top needs-scoring list
    if needs_scoring:
        print(f"\nTop predictions needing manual scoring:")
        for p in needs_scoring[:10]:
            print(f"  [{p['id']}] p={p.get('probability'):.0%} | {p.get('event','')[:70]}")
            print(f"    outcome={p.get('resolution_outcome')} | conf={p.get('resolution_confidence')} | date={p.get('target_date')}")


def cmd_score(pred_list):
    scored = []
    for p in pred_list:
        oc = outcome_to_float(p.get("was_correct"), p.get("resolution_outcome"))
        if oc is not None and p.get("probability") is not None:
            bs = brier_score(float(p["probability"]), oc)
            p["brier_score"] = round(bs, 6)
            p["calibration_scored_at"] = datetime.now(timezone.utc).isoformat()
            scored.append(p)
    print(f"Scored {len(scored)} predictions.")
    save_preds(pred_list)


def cmd_mark(pred_list, pred_id: str, verdict: str):
    mapping = {"correct": (True, 1.0), "wrong": (False, 0.0), "partial": (None, 0.5)}
    was_correct, outcome_float = mapping[verdict]

    found = False
    for p in pred_list:
        if p.get("id") == pred_id:
            p["was_correct"] = was_correct
            p["resolution_outcome"] = "confirmed" if was_correct else ("partial" if verdict == "partial" else "refuted")
            p["resolved"] = True
            p["resolution_date"] = datetime.now(timezone.utc).date().isoformat()
            p["resolution_confidence"] = "high"
            bs = brier_score(float(p["probability"]), outcome_float)
            p["brier_score"] = round(bs, 6)
            p["calibration_scored_at"] = datetime.now(timezone.utc).isoformat()
            print(f"Marked {pred_id} as {verdict}.")
            print(f"  Probability: {p['probability']:.0%} | Outcome: {outcome_float} | Brier: {bs:.4f}")
            found = True
            break
    if not found:
        print(f"ERROR: prediction {pred_id} not found.")
        return
    save_preds(pred_list)


def cmd_report(pred_list):
    today = datetime.now(timezone.utc).date()
    scored = [p for p in pred_list if p.get("brier_score") is not None]

    print(f"\n{'='*60}")
    print(f"PIE CALIBRATION REPORT — {today}")
    print(f"{'='*60}")

    if not scored:
        print("No scored predictions yet.")
        return

    scores = [p["brier_score"] for p in scored]
    probs = [float(p["probability"]) for p in scored]
    outcomes = [outcome_to_float(p.get("was_correct"), p.get("resolution_outcome")) for p in scored]

    print(f"\nOverall (n={len(scored)}):")
    print(f"  Mean Brier:      {statistics.mean(scores):.4f}")
    print(f"  Baseline (0.25): {0.25:.4f}  (random guesser)")
    print(f"  Skill score:     {1 - statistics.mean(scores)/0.25:.2%}  (positive = better than random)")

    # Breakdown by probability bucket
    buckets = defaultdict(list)
    for p, o in zip(probs, outcomes):
        if o is None: continue
        bucket = f"{int(p*10)*10}%-{int(p*10)*10+9}%"
        buckets[bucket].append((p, o))

    print(f"\nCalibration by probability bucket:")
    print(f"  {'Bucket':<12} {'N':>4} {'Stated%':>8} {'Actual%':>8} {'Brier':>7}")
    for bucket in sorted(buckets):
        items = buckets[bucket]
        n = len(items)
        stated = statistics.mean(p for p, _ in items)
        actual = statistics.mean(o for _, o in items)
        bs = statistics.mean(brier_score(p, o) for p, o in items)
        flag = " ⚠️ overconfident" if stated - actual > 0.15 else (" ⚠️ underconfident" if actual - stated > 0.15 else "")
        print(f"  {bucket:<12} {n:>4} {stated:>8.0%} {actual:>8.0%} {bs:>7.4f}{flag}")

    # By domain
    domain_scores = defaultdict(list)
    for p in scored:
        d = p.get("domain") or "unknown"
        domain_scores[d].append(p["brier_score"])
    print(f"\nBrier by domain:")
    for d, sc in sorted(domain_scores.items(), key=lambda x: statistics.mean(x[1])):
        print(f"  {d:<25} n={len(sc)} mean={statistics.mean(sc):.4f}")

    # Verdict
    mean_brier = statistics.mean(scores)
    if mean_brier < 0.1:
        verdict = "✅ EXCELLENT — well-calibrated"
    elif mean_brier < 0.2:
        verdict = "✅ GOOD — better than random"
    elif mean_brier < 0.25:
        verdict = "⚠️  MARGINAL — barely better than random"
    else:
        verdict = "❌ POOR — worse than random guesser"
    print(f"\nVerdict: {verdict}")


def main():
    parser = argparse.ArgumentParser(description="PIE Calibration Scorer")
    parser.add_argument("--score", action="store_true", help="Score all resolvable predictions")
    parser.add_argument("--mark", metavar="ID", help="Prediction ID to mark")
    parser.add_argument("--correct", action="store_true")
    parser.add_argument("--wrong", action="store_true")
    parser.add_argument("--partial", action="store_true")
    parser.add_argument("--report", action="store_true", help="Full calibration report")
    args = parser.parse_args()

    pred_list = load_preds()

    if args.mark:
        verdict = "correct" if args.correct else "wrong" if args.wrong else "partial" if args.partial else None
        if not verdict:
            print("ERROR: --mark requires --correct, --wrong, or --partial")
            return
        cmd_mark(pred_list, args.mark, verdict)
    elif args.score:
        cmd_score(pred_list)
    elif args.report:
        cmd_report(pred_list)
    else:
        cmd_status(pred_list)


if __name__ == "__main__":
    main()
