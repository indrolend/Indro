import pathlib
import random
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import indro_lang as lang

words = lang.load_words(ROOT / "words.json")
source = (ROOT / "examples" / "repair.i").read_text(encoding="utf-8")
program = lang.parse(source)
values = lang.bind(program, {"target": "src/audio.cpp"})
ids = {lang.compile_program(program, values, words, {"write"})["planId"] for _ in range(1000)}
assert len(ids) == 1
changed = lang.compile_program(program, lang.bind(program, {"target": "src/render.cpp"}), words, {"write"})["planId"]
assert changed not in ids

rng = random.Random(700)
accepted = rejected = 0
for index in range(500):
    indent = " " * rng.randrange(0, 7)
    word = rng.choice(["o", "p", "ck", "missing", "ship", "||", "~"])
    candidate = f"@ fuzz{index}\n! fuzz\n+ rwx\n: main\n{indent}> {word}\n"
    try:
        parsed = lang.parse(candidate)
        lang.compile_program(parsed, {}, words, {"write", "network", "publish"})
        accepted += 1
    except lang.IndroError:
        rejected += 1
assert accepted + rejected == 500
assert accepted and rejected
print(f"INDRO_TEST PASS deterministic_compiles=1000 grammar_fuzz=500 accepted={accepted} rejected={rejected}")
