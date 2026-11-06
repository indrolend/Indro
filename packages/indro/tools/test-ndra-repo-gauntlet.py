"""Focused tests for the static open-source NDRA gauntlet."""
import importlib.util, sys
from pathlib import Path
path=Path(__file__).with_name("ndra_repo_gauntlet.py")
spec=importlib.util.spec_from_file_location("ndra_repo_gauntlet",path)
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
module.self_test()
