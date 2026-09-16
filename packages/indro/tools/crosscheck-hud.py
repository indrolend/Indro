"""Cross-check the bounded HUD prefix parser against canonical JSON parsing.

Huge historical stress records are intentionally skipped here; their purpose is
covered by the bounded-memory benchmark. Every reasonably-sized record is
parsed both ways and key top-level metadata must agree exactly.
"""
import argparse
import glob
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
parser.add_argument("--max-full-mib", type=float, default=5.0)
parser.add_argument("--json", action="store_true")
ns = parser.parse_args()
root = miner.resolve_root(ns.root)
limit = int(ns.max_full_mib * 1024 * 1024)
checked = skipped = 0
mismatches = []
for path in glob.glob(os.path.join(root, "runs", "*", "*", "run.json")):
    size = os.path.getsize(path)
    if size > limit:
        skipped += 1
        continue
    try:
        compact = miner.summarize_prefix(path)
        with open(path, encoding="utf-8-sig") as handle:
            doc = json.load(handle)
        expected = {
            "id": doc.get("id") or os.path.basename(os.path.dirname(path)),
            "project": doc.get("project") or "",
            "root": doc.get("root") or doc.get("cwd") or "?",
            "status": (doc.get("status") or "").lower(),
            "command": doc.get("command") or "",
            "objective": doc.get("objective") or "",
            "request": doc.get("request") or "",
            "startedAt": doc.get("startedAt") or "",
            "durationMs": int(float(doc.get("durationMs") or 0)),
        }
        for field, value in expected.items():
            if compact[field] != value:
                mismatches.append({
                    "path": path,
                    "field": field,
                    "compact": compact[field],
                    "canonical": value,
                })
        checked += 1
    except Exception as exc:
        mismatches.append({"path": path, "field": "exception", "compact": repr(exc), "canonical": ""})

report = {
    "ok": not mismatches and checked > 0,
    "root": root,
    "checked": checked,
    "skippedLarge": skipped,
    "maxFullBytes": limit,
    "mismatches": mismatches[:20],
}
if ns.json:
    print(json.dumps(report, indent=2))
else:
    print(
        f"INDRO_CROSSCHECK {'PASS' if report['ok'] else 'FAIL'} "
        f"checked={checked} skipped_large={skipped} mismatches={len(mismatches)}"
    )
    for mismatch in mismatches[:10]:
        print("MISMATCH", mismatch)
raise SystemExit(0 if report["ok"] else 1)
