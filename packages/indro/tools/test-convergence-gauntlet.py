"""Focused integration test for the read-only cross-repository gauntlet."""
import pathlib
import sys

path = pathlib.Path(__file__).with_name("convergence_gauntlet.py")
sys.path.insert(0, str(path.parent))
import convergence_gauntlet

workspace = pathlib.Path.home() / "Projects"
required = ["Continuum", "Indro", "Indro-NDRA-Formal-Compare", "workflow-gauntlet"]
missing = [name for name in required if not (workspace / name / ".git").exists()]
if missing:
    print("INDRO_TEST SKIP convergence gauntlet missing=" + ",".join(missing))
else:
    convergence_gauntlet.self_test(workspace)
