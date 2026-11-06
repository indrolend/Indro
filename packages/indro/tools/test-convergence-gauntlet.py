"""Focused integration test for the read-only cross-repository gauntlet."""
import pathlib
import sys

path = pathlib.Path(__file__).with_name("convergence_gauntlet.py")
sys.path.insert(0, str(path.parent))
import convergence_gauntlet

convergence_gauntlet.self_test(pathlib.Path.home() / "Projects")
