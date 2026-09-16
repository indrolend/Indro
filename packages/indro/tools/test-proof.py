import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from indro_proof import ProofPlanner

planner = ProofPlanner()
state = {"source": "s0", "tests": "t0", "config": "c0", "toolchain": "tc0", "runtime": "r0"}
first = planner.plan(["verified"], state, {})
assert first["run"] == ["parse", "lint", "build", "test", "smoke", "verified"]
assert not first["reuse"]

warm = planner.plan(["verified"], state, first["fingerprints"])
assert warm["run"] == []
assert set(warm["reuse"]) == {"parse", "lint", "build", "test", "smoke", "verified"}

test_change = dict(state, tests="t1")
changed = planner.plan(["verified"], test_change, first["fingerprints"])
assert changed["run"] == ["test", "smoke", "verified"], changed
assert changed["reuse"] == ["parse", "lint", "build"], changed

runtime_change = dict(state, runtime="r1")
runtime = planner.plan(["verified"], runtime_change, first["fingerprints"])
assert runtime["run"] == ["smoke", "verified"], runtime

toolchain_change = dict(state, toolchain="tc1")
toolchain = planner.plan(["verified"], toolchain_change, first["fingerprints"])
assert toolchain["run"] == ["parse", "lint", "build", "test", "smoke", "verified"]

assert planner.plan(["verified"], state, first["fingerprints"])["planId"] == warm["planId"]
print("INDRO_TEST PASS proof planner cold=6 warm=0 tests_changed=3 runtime_changed=2")
