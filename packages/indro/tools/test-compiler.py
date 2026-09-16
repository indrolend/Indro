import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import indro_lang as lang

words = lang.load_words(__import__("pathlib").Path(ROOT) / "words.json")
source = """program fix
intent "fix ${target}"
param target: path
param retries: integer = 2
param mode: choice(fast|full) = fast
permit read write exec
flow main:
  do orient
  parallel:
    do test ${target}
    do doctor
  ensure "verified ${target}"
  recover:
    do checkpoint
"""
program = lang.parse(source)
bound = lang.bind(program, {"target": "src/motor.cpp"})
plan = lang.compile_program(program, bound, words, {"write"})
assert plan["program"] == "fix"
assert plan["intent"] == "fix src/motor.cpp"
assert plan["bindings"]["retries"] == 2
assert plan["inferredEffects"] == ["read", "write", "exec"]
assert len(plan["planId"]) == 20
assert json.dumps(plan).count("src/motor.cpp") >= 2
assert lang.compile_program(program, bound, words, {"write"})["planId"] == plan["planId"]

try:
    lang.compile_program(program, bound, words, set())
    raise AssertionError("write effect ran without invocation authority")
except lang.IndroError as exc:
    assert "not allowed" in str(exc)

try:
    lang.parse("program x\nintent x\nflow main:\n do status\n")
    raise AssertionError("odd indentation accepted")
except lang.IndroError as exc:
    assert "indentation" in str(exc)

try:
    bad = lang.parse("program x\nintent x\npermit read\nflow main:\n  do ship\n")
    lang.compile_program(bad, {}, words, {"publish", "write", "network"})
    raise AssertionError("undeclared effects accepted")
except lang.IndroError as exc:
    assert "undeclared effects" in str(exc)

release = lang.parse("""program release
intent "release ${version}"
param version: string
permit read write exec network publish
flow main:
  do ship ${version}
""")
release_values = lang.bind(release, {"version": "0.6.0"})
try:
    lang.compile_program(release, release_values, words, {"write", "network"})
    raise AssertionError("publish ran without invocation authority")
except lang.IndroError as exc:
    assert "publish" in str(exc)
release_plan = lang.compile_program(release, release_values, words, {"write", "network", "publish"})
assert release_plan["nodes"][0]["steps"][0]["word"] == "ship"

cli = os.path.join(ROOT, "indro_lang.py")
result = subprocess.run(
    [sys.executable, cli, os.path.join(ROOT, "examples", "repair.indro"),
     "--set", "target=Indro.psm1", "--allow-effect", "write", "--check"],
    text=True, capture_output=True,
)
assert result.returncode == 0, result.stderr
assert "INDRO_CHECK PASS" in result.stdout
print("INDRO_TEST PASS typed intent compiler/effect system")
