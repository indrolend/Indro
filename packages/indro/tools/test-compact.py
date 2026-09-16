import json
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import indro_lang as lang

words = lang.load_words(ROOT / "words.json")
full_source = (ROOT / "examples" / "repair.indro").read_text(encoding="utf-8")
short_source = (ROOT / "examples" / "repair.i").read_text(encoding="utf-8")
values = {"target": "src/motor.cpp"}
full_program = lang.parse(full_source)
short_program = lang.parse(short_source)
full = lang.compile_program(full_program, lang.bind(full_program, values), words, {"write"})
short = lang.compile_program(short_program, lang.bind(short_program, values), words, {"write"})
assert full["planId"] == short["planId"], (full["planId"], short["planId"])
assert full["inferredEffects"] == short["inferredEffects"]
assert len(short_source) < len(full_source)

compact = lang.compact_plan(short)
encoded = json.dumps(compact, separators=(",", ":"))
verbose = json.dumps(short, separators=(",", ":"))
assert len(encoded) < len(verbose) * 0.65, (len(encoded), len(verbose))
assert compact["id"] == short["planId"]

cli = ROOT / "indro_lang.py"
result = subprocess.run([sys.executable, str(cli), str(ROOT / "examples" / "repair.i"),
                         "--set", "target=x", "--allow-effect", "write", "--format", "compact"],
                        text=True, capture_output=True)
assert result.returncode == 0, result.stderr
assert json.loads(result.stdout)["p"] == "repair"
print(f"INDRO_TEST PASS compact syntax/IR source_bytes={len(short_source)}/{len(full_source)} ir_bytes={len(encoded)}/{len(verbose)}")
