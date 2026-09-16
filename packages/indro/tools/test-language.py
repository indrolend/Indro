import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
MINER = os.path.join(HERE, "mine-hud.py")
spec = importlib.util.spec_from_file_location("indro_hud_miner", MINER)
miner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(miner)

assert miner.phase_from_family("git:status") == "orient"
assert miner.phase_from_family("git:rev-parse") == "orient"
assert miner.phase_from_family("search") == "inspect"
assert miner.phase_from_family("git:show") == "inspect"
assert miner.phase_from_family("git:diff") == "compare"
assert miner.phase_from_family("edit") == "modify"
assert miner.phase_from_family("build") == "build"
assert miner.phase_from_family("test") == "test"

sessions = [
    [
        {"project":"a","family":"git:status"},
        {"project":"a","family":"git:rev-parse"},
        {"project":"a","family":"search"},
        {"project":"a","family":"inspect"},
        {"project":"a","family":"test"},
    ],
    [
        {"project":"b","family":"git:status"},
        {"project":"b","family":"search"},
        {"project":"b","family":"test"},
    ],
    [
        {"project":"b","family":"git:status"},
        {"project":"b","family":"search"},
        {"project":"b","family":"test"},
    ],
]
traces = miner.phase_sessions(sessions)
assert traces[0]["phases"] == ["orient","inspect","test"], traces[0]
motifs = miner.discover_motifs(traces, min_n=2, max_n=3, min_support=3, min_projects=2)
assert motifs[0]["sequence"] == ["orient","inspect","test"], motifs
stats = miner.compression_stats(traces, motifs[:1])
assert stats["before"] == 9 and stats["saved"] == 6, stats
print("INDRO_TEST PASS semantic phase/motif compression")
