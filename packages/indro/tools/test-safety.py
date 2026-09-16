import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, "indro.py")
spec = importlib.util.spec_from_file_location("indro_cli", CLI)
indro = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indro)

# Actual runtime resolver, not a duplicated test-only implementation.
assert indro.resolve("resume") == ["status", "audit"]
assert indro.resolve("measure") == ["bench", "languagebench", "crosscheck"]

try:
    indro.resolve("a", {"a":{"steps":["b"]}, "b":{"steps":["a"]}})
    raise AssertionError("cycle accepted")
except ValueError as exc:
    assert "cycle" in str(exc).lower()

try:
    indro.resolve("bad", {"bad":{"steps":["commit"]}})
    raise AssertionError("hidden consequential command accepted")
except ValueError as exc:
    assert "consequential" in str(exc).lower()

try:
    indro.resolve("bad", {"bad":{"steps":["missing"]}})
    raise AssertionError("unknown nested word accepted")
except ValueError as exc:
    assert "unknown" in str(exc).lower()

try:
    indro.resolve("bad", {"bad":{"steps":["resume extra"]}, "resume":{"steps":["status","audit"]}})
    raise AssertionError("arguments to composite accepted")
except ValueError as exc:
    assert "unsupported" in str(exc).lower()

print("INDRO_TEST PASS runtime resolver safety")
