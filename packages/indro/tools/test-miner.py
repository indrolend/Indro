import importlib.util
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MINER = os.path.join(HERE, "mine-hud.py")
spec = importlib.util.spec_from_file_location("indro_hud_miner", MINER)
miner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(miner)

# Family classification: wrappers, git, tests, and copied-output mistakes.
assert miner.family_from("git -C repo status --short") == "git:status"
assert miner.family_from("powershell -NoProfile -Command \"Select-String -Path x -Pattern y\"") == "search"
assert miner.family_from("npm test") == "test"
assert miner.tool(r"C:\Program Files\nodejs\node.exe --version") == "node.exe"
assert miner.family_from(r'C:\WINDOWS\system32\cmd.exe /d /s /c "npm.cmd run test"') == "test"
assert miner.family_from("git --version") == "git:version"
assert miner.family_from('run_logged multiplayer "$BUILD_DIR/MultiplayerProtocolTest"') == "test"
assert miner.family_from("MULTIPLAYER_ENEMY_VISUAL_TRANSITION target=0", "fail", "command-not-found") == "invalid-command"

with tempfile.TemporaryDirectory() as d:
    base = os.path.join(d, "hud", "runs", "p")
    rows = [
        ("001", "pass", "git status", "2026-01-01T00:00:00Z", "root-a", None),
        ("002", "fail", "npm test", "2026-01-01T00:00:10Z", "root-a", {"classification": "command"}),
        ("003", "pass", "rg needle", "2026-01-01T00:00:20Z", "root-a", None),
        # More than 10 minutes later: must not be treated as recovery from 002.
        ("004", "pass", "cmake --build build", "2026-01-01T00:20:20Z", "root-a", None),
        # Different root: must be a different session.
        ("005", "pass", "git diff", "2026-01-01T00:00:30Z", "root-b", None),
    ]
    for ident, status, cmd, started, root, reduction in rows:
        p = os.path.join(base, ident)
        os.makedirs(p)
        doc = {"id": ident, "project": "p", "root": root, "status": status, "command": cmd, "startedAt": started}
        if reduction:
            doc["reduction"] = reduction
        with open(os.path.join(p, "run.json"), "w") as f:
            json.dump(doc, f)
    # Add one malformed record and ensure mining survives it.
    broken = os.path.join(base, "006")
    os.makedirs(broken)
    open(os.path.join(broken, "run.json"), "w").write("{not-json")

    root = miner.resolve_root(d)
    runs, bad, payload, bytes_read = miner.load_runs(root)
    a = miner.analyze(runs, bad, payload, bytes_read)
    assert a["runs"] == 5 and a["projects"] == 1 and a["malformed"] == 1
    assert a["status"] == {"pass": 4, "fail": 1}
    assert a["intentSignal"]["missing"] == 5, a["intentSignal"]
    assert a["sessions"] == 3, a["sessions"]
    assert ("search", 1) in a["afterFailure"], a["afterFailure"]
    assert ("search", 1) in a["firstPassAfterFailure"], a["firstPassAfterFailure"]
    assert not any(k == "build" for k, _ in a["afterFailure"])


# Null top-level string fields must not fall through to later nested fields.
with tempfile.TemporaryDirectory() as d:
    p = os.path.join(d, "run.json")
    doc = {
        "id": "shadow",
        "project": "p",
        "root": "r",
        "request": None,
        "objective": None,
        "command": "echo ok",
        "startedAt": "2026-01-01T00:00:00Z",
        "durationMs": 1,
        "status": "pass",
        "evidence": {"request": "nested-wrong", "objective": "nested-wrong"},
    }
    with open(p, "w") as f:
        json.dump(doc, f)
    row = miner.summarize_prefix(p)
    assert row["request"] == "", row
    assert row["objective"] == "", row

print("INDRO_TEST PASS miner classification/session/failure recovery")
