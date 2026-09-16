"""Benchmark whether semantic Indro motifs generalize beyond shell macros.

The benchmark deliberately trains on the earlier 80% of semantic sessions and
measures the later 20%. It compares exact command-family motifs with the more
abstract Indro phase vocabulary. Better holdout compression from phases is
positive evidence that Indro should encode intent, not merely aliases/macros.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MINER = os.path.join(HERE, "mine-hud.py")
ROOT_ARG = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else r"D:\hud"
spec = importlib.util.spec_from_file_location("indro_hud_miner", MINER)
miner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(miner)
root = miner.resolve_root(ROOT_ARG)
runs, malformed, payload, read = miner.load_runs(root)
sessions = miner.semantic_sessions(miner.sessionize(runs))
cut = max(1, int(len(sessions) * 0.8))
train_sessions, holdout_sessions = sessions[:cut], sessions[cut:]


def exact_traces(source):
    return [{"project": s[0]["project"], "phases": [r["family"] for r in s]} for s in source]


def top_motifs(traces, max_n, limit=12):
    return miner.discover_motifs(traces, min_n=2, max_n=max_n, min_support=3, min_projects=2)[:limit]

exact_train = exact_traces(train_sessions)
exact_holdout = exact_traces(holdout_sessions)
phase_train = miner.phase_sessions(train_sessions)
phase_holdout = miner.phase_sessions(holdout_sessions)
exact_motifs = top_motifs(exact_train, 5)
phase_motifs = top_motifs(phase_train, 4)

raw_train_tokens = sum(len(t["phases"]) for t in exact_train)
raw_holdout_tokens = sum(len(t["phases"]) for t in exact_holdout)
phase_train_tokens = sum(len(t["phases"]) for t in phase_train)
phase_holdout_tokens = sum(len(t["phases"]) for t in phase_holdout)

def stability_report():
    gap_sets = {}
    for gap in (300, 600, 1200, 1800):
        gap_sessions = miner.semantic_sessions(miner.sessionize(runs, gap))
        gap_traces = miner.phase_sessions(gap_sessions)
        gap_motifs = miner.discover_motifs(gap_traces, min_n=2, max_n=4, min_support=3, min_projects=2)[:10]
        gap_sets[gap] = {tuple(x["sequence"]) for x in gap_motifs}
    pairs = []
    keys = sorted(gap_sets)
    for i, left in enumerate(keys):
        for right in keys[i+1:]:
            union = gap_sets[left] | gap_sets[right]
            overlap = len(gap_sets[left] & gap_sets[right]) / len(union) if union else 1.0
            pairs.append({"leftGap": left, "rightGap": right, "jaccard": overlap})
    return {
        "gaps": keys,
        "pairwise": pairs,
        "minJaccard": min((x["jaccard"] for x in pairs), default=1.0),
    }

stability = stability_report()
report = {
    "root": root,
    "runs": len(runs),
    "semanticSessions": len(sessions),
    "trainSessions": len(train_sessions),
    "holdoutSessions": len(holdout_sessions),
    "representation": {
        "trainRawActions": raw_train_tokens,
        "trainPhaseActions": phase_train_tokens,
        "trainPhaseReduction": (raw_train_tokens - phase_train_tokens) / raw_train_tokens if raw_train_tokens else 0.0,
        "holdoutRawActions": raw_holdout_tokens,
        "holdoutPhaseActions": phase_holdout_tokens,
        "holdoutPhaseReduction": (raw_holdout_tokens - phase_holdout_tokens) / raw_holdout_tokens if raw_holdout_tokens else 0.0,
    },
    "stability": stability,
    "exact": {
        "motifs": exact_motifs,
        "train": miner.compression_stats(exact_train, exact_motifs),
        "holdout": miner.compression_stats(exact_holdout, exact_motifs),
    },
    "semantic": {
        "motifs": phase_motifs,
        "train": miner.compression_stats(phase_train, phase_motifs),
        "holdout": miner.compression_stats(phase_holdout, phase_motifs),
    },
}
checks = {
    "corpus_nonempty": len(runs) > 0,
    "sessions_split": len(train_sessions) > 0 and len(holdout_sessions) > 0,
    "semantic_motifs_found": bool(phase_motifs),
    "all_semantic_motifs_cross_project": all(x["projects"] >= 2 for x in phase_motifs),
    "holdout_accounting": report["semantic"]["holdout"]["after"] <= report["semantic"]["holdout"]["before"],
    "session_gap_motif_stability": stability["minJaccard"] >= 0.50,
}
# Regression assertions only for the known dogfood corpus shape. A live store is
# allowed to evolve rather than being pinned forever to one percentage.
if len(runs) == 863 and len(sessions) >= 90:
    checks.update({
        "known_semantic_holdout_reduction_ge_10pct": report["semantic"]["holdout"]["reduction"] >= 0.10,
        "known_semantics_outgeneralize_exact": report["semantic"]["holdout"]["reduction"] > report["exact"]["holdout"]["reduction"],
        "known_phase_abstraction_reduction_ge_40pct": report["representation"]["holdoutPhaseReduction"] >= 0.40,
    })
report["checks"] = checks
report["ok"] = all(checks.values())
if "--json" in sys.argv:
    print(json.dumps(report, indent=2))
else:
    print(
        f"INDRO_LANGUAGE_BENCH {'PASS' if report['ok'] else 'FAIL'} runs={len(runs)} "
        f"train={len(train_sessions)} holdout={len(holdout_sessions)}"
    )
    for name in ("exact", "semantic"):
        tr = report[name]["train"]
        ho = report[name]["holdout"]
        print(
            f"{name.upper()} train_reduction={tr['reduction']:.3%} holdout_reduction={ho['reduction']:.3%} "
            f"holdout_saved={ho['saved']}/{ho['before']}"
        )
    rep = report["representation"]
    overall_after = report["semantic"]["holdout"]["after"]
    overall_reduction = (rep["holdoutRawActions"] - overall_after) / rep["holdoutRawActions"] if rep["holdoutRawActions"] else 0.0
    print(
        f"ABSTRACTION holdout_raw={rep['holdoutRawActions']} holdout_phases={rep['holdoutPhaseActions']} "
        f"phase_reduction={rep['holdoutPhaseReduction']:.3%} overall_to_words={overall_reduction:.3%}"
    )
    print(f"STABILITY min_top10_jaccard={stability['minJaccard']:.3f} gaps={','.join(map(str, stability['gaps']))}")
    for key, value in checks.items():
        print(f"{'PASS' if value else 'FAIL'} {key}")
    print("TOP_SEMANTIC", " | ".join(
        f"{'>'.join(x['sequence'])} x{x['count']} p{x['projects']}" for x in phase_motifs[:8]
    ))
raise SystemExit(0 if report["ok"] else 1)
