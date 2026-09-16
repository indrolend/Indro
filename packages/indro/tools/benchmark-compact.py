"""Measure semantic-equivalent source and IR representation cost."""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import indro_lang as lang

words = lang.load_words(ROOT / "words.json")
bindings = {"target": "src/motor.cpp"}
plans = []
sources = []
for name in ("repair.indro", "repair.i"):
    source = (ROOT / "examples" / name).read_text(encoding="utf-8")
    program = lang.parse(source)
    plan = lang.compile_program(program, lang.bind(program, bindings), words, {"write"})
    plans.append(plan)
    sources.append(source)

assert plans[0]["planId"] == plans[1]["planId"]
verbose_ir = json.dumps(plans[0], separators=(",", ":"))
compact_ir = json.dumps(lang.compact_plan(plans[1]), separators=(",", ":"))
tokens = lambda text: len(re.findall(r"\w+|[^\w\s]", text))
report = {
    "ok": True,
    "planId": plans[0]["planId"],
    "source": {
        "fullBytes": len(sources[0].encode()), "compactBytes": len(sources[1].encode()),
        "fullLexemes": tokens(sources[0]), "compactLexemes": tokens(sources[1]),
    },
    "ir": {
        "fullBytes": len(verbose_ir.encode()), "compactBytes": len(compact_ir.encode()),
        "fullLexemes": tokens(verbose_ir), "compactLexemes": tokens(compact_ir),
    },
}
report["source"]["byteReduction"] = 1 - report["source"]["compactBytes"] / report["source"]["fullBytes"]
report["ir"]["byteReduction"] = 1 - report["ir"]["compactBytes"] / report["ir"]["fullBytes"]
if "--json" in sys.argv:
    print(json.dumps(report, indent=2))
else:
    print(f"INDRO_COMPACT_BENCH PASS plan={report['planId']}")
    print(f"SOURCE bytes={report['source']['compactBytes']}/{report['source']['fullBytes']} reduction={report['source']['byteReduction']:.1%} lexemes={report['source']['compactLexemes']}/{report['source']['fullLexemes']}")
    print(f"IR bytes={report['ir']['compactBytes']}/{report['ir']['fullBytes']} reduction={report['ir']['byteReduction']:.1%} lexemes={report['ir']['compactLexemes']}/{report['ir']['fullLexemes']}")
