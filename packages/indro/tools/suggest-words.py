"""Suggest Indro vocabulary from project-diverse CommandHUD motifs."""
import argparse
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MINER = os.path.join(HERE, "mine-hud.py")
spec = importlib.util.spec_from_file_location("indro_hud_miner", MINER)
miner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(miner)

parser = argparse.ArgumentParser()
parser.add_argument("root", nargs="?", default=r"D:\hud")
parser.add_argument("--json", action="store_true")
parser.add_argument("--limit", type=int, default=12)
ns = parser.parse_args()
root = miner.resolve_root(ns.root)
runs, malformed, payload, read = miner.load_runs(root)
sessions = miner.semantic_sessions(miner.sessionize(runs))
traces = miner.phase_sessions(sessions)
all_motifs = miner.discover_motifs(traces, min_n=2, max_n=4, min_support=3, min_projects=1)
core = [row for row in all_motifs if row["projects"] >= 2]
dialect = [row for row in all_motifs if row["projects"] == 1 and row["count"] >= 4]
result = {
    "root": root,
    "runs": len(runs),
    "sessions": len(sessions),
    "semanticTraces": len(traces),
    "malformed": len(malformed),
    "coreMotifs": core[:ns.limit],
    "dialectMotifs": dialect[:ns.limit],
}
if ns.json:
    print(json.dumps(result, indent=2))
else:
    print(f"INDRO_SUGGEST runs={len(runs)} sessions={len(sessions)} core={len(core)} dialect={len(dialect)}")
    for row in core[:ns.limit]:
        print(
            f"CORE support={row['count']} projects={row['projects']} savings={row['grossSavings']} "
            + " -> ".join(row["sequence"])
        )
    for row in dialect[:ns.limit]:
        project = row["projectNames"][0] if row["projectNames"] else "?"
        print(
            f"DIALECT support={row['count']} project={project} savings={row['grossSavings']} "
            + " -> ".join(row["sequence"])
        )
