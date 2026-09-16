"""Correctness + performance benchmark for Indro's HUD miner."""
import importlib.util
import json
import os
import sys
import time
import tracemalloc

HERE = os.path.dirname(os.path.abspath(__file__))
MINER_PATH = os.path.join(HERE, "mine-hud.py")
ROOT_ARG = sys.argv[1] if len(sys.argv) > 1 else r"D:\hud"

spec = importlib.util.spec_from_file_location("indro_hud_miner", MINER_PATH)
miner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(miner)
root = miner.resolve_root(ROOT_ARG)

tracemalloc.start()
t0 = time.perf_counter()
runs, malformed, payload_bytes, bytes_read = miner.load_runs(root)
analysis = miner.analyze(runs, malformed, payload_bytes, bytes_read)
elapsed = time.perf_counter() - t0
_, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()

checks = {
    "corpus_nonempty": analysis["runs"] > 0,
    "no_malformed_records": analysis["malformed"] == 0,
    "status_accounting": sum(analysis["status"].values()) == analysis["runs"],
    "projects_nonempty": analysis["projects"] > 0,
    "sessions_nonempty": analysis["sessions"] > 0,
    "tool_coverage": len(analysis["tools"]) > 0,
    "transition_coverage": len(analysis["pairs"]) > 0,
    "failure_recovery_signal": len(analysis["afterFailure"]) > 0 if analysis["status"].get("fail", 0) else True,
    "intent_accounting": sum(analysis["intentSignal"][k] for k in ("meaningful","generic","missing")) == analysis["runs"],
}
# Regression guard for the supplied HUD dogfood corpus; a live store may grow.
if analysis["runs"] >= 863:
    checks.update(
        {
            "known_corpus_floor": analysis["runs"] >= 863,
            "known_project_floor": analysis["projects"] >= 17,
            "known_pass_floor": analysis["status"].get("pass", 0) >= 663,
            # The compact miner should not retain hundreds of MB of reduction payloads.
            "peak_python_under_256mb": peak < 256 * 1024 * 1024,
        }
    )

ok = all(checks.values())
rate = analysis["runs"] / elapsed if elapsed else 0
report = {
    "ok": ok,
    "root": root,
    "runs": analysis["runs"],
    "projects": analysis["projects"],
    "sessions": analysis["sessions"],
    "malformed": analysis["malformed"],
    "payloadBytes": payload_bytes,
    "bytesRead": bytes_read,
    "readFraction": round(bytes_read / payload_bytes, 6) if payload_bytes else 0,
    "elapsedSeconds": round(elapsed, 4),
    "runsPerSecond": round(rate, 2),
    "peakPythonBytes": peak,
    "peakPythonMiB": round(peak / 1024 / 1024, 2),
    "checks": checks,
    "intentSignal": analysis["intentSignal"],
    "topAfterFailure": analysis["afterFailure"][:8],
    "topRecoveryActions": analysis["recoveryActions"][:8],
    "topWorkflowTriples": analysis["workflowTriples"][:8],
    "topSemanticMotifs": analysis["semanticMotifs"][:8],
}

if "--json" in sys.argv:
    print(json.dumps(report, indent=2))
else:
    print(
        f"INDRO_BENCH {'PASS' if ok else 'FAIL'} runs={analysis['runs']} projects={analysis['projects']} "
        f"sessions={analysis['sessions']} malformed={analysis['malformed']}"
    )
    print(
        f"PERF seconds={elapsed:.3f} runs_per_second={rate:.1f} "
        f"peak_python_mib={peak/1024/1024:.1f} payload_mib={payload_bytes/1024/1024:.1f}"
    )
    for key, value in checks.items():
        print(f"{'PASS' if value else 'FAIL'} {key}")
    intent = analysis["intentSignal"]
    print(
        f"INTENT meaningful={intent['meaningful']} generic={intent['generic']} missing={intent['missing']} "
        f"meaningful_fraction={intent['meaningfulFraction']:.3f}"
    )
    print("TOP_AFTER_FAIL", " ".join(f"{k}={v}" for k, v in analysis["afterFailure"][:8]))
    print("TOP_RECOVERY", " ".join(f"{k}={v}" for k, v in analysis["recoveryActions"][:8]))
    print(
        "TOP_WORKFLOWS",
        " ".join(f"{'>'.join(x['sequence'])}={x['count']}" for x in analysis["workflowTriples"][:6]),
    )
    print(
        "TOP_SEMANTIC",
        " ".join(f"{'>'.join(x['sequence'])}={x['count']}@{x['projects']}p" for x in analysis["semanticMotifs"][:6]),
    )
raise SystemExit(0 if ok else 1)
