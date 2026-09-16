#!/usr/bin/env python3
"""Portable Indro meta-runner.

PowerShell remains the full Windows workspace backend. This runner exists so
Indro can dogfood its evidence/miner/test vocabulary anywhere Python 3 runs.
It deliberately executes only workspace-free primitives.
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
WORDS_PATH = os.path.join(ROOT, "words.json")
PRIMITIVES = {
    "status","audit","checkpoint","save","verify","build","test","smoke","play","doctor",
    "agent","diffcheck","ship","dogfood","suggest","bench","languagebench","crosscheck","selftest","evidence",
}
CONSEQUENTIAL = {"commit","push","merge","rebase","reset","clean","release","publish","ship"}
PORTABLE = {"dogfood","suggest","bench","languagebench","crosscheck","selftest"}


def definitions():
    with open(WORDS_PATH, encoding="utf-8") as handle:
        return json.load(handle)["words"]


def resolve(word, defs=None, stack=()):
    defs = defs or definitions()
    if word in stack:
        raise ValueError("Indro word cycle: " + " -> ".join(stack + (word,)))
    if word in PRIMITIVES:
        return [word]
    if word not in defs:
        raise ValueError(f"Unknown Indro word '{word}'.")
    plan = []
    for step in defs[word]["steps"]:
        parts = step.split()
        if not parts:
            continue
        verb = parts[0]
        if verb in CONSEQUENTIAL:
            raise ValueError(f"Composite word '{word}' may not imply consequential '{verb}'.")
        if len(parts) > 1:
            if verb not in PRIMITIVES:
                raise ValueError(f"Argument-bearing composite step is unsupported: {step}")
            plan.append(step)
        else:
            plan.extend(resolve(verb, defs, stack + (word,)))
    return plan


def run_python(script, *args):
    command = [sys.executable, os.path.join(ROOT, "tools", script), *args]
    result = subprocess.run(command)
    if result.returncode:
        raise SystemExit(result.returncode)


def run_primitive(step, hud_root):
    parts = step.split()
    verb = parts[0]
    if verb not in PORTABLE:
        raise RuntimeError(
            f"'{verb}' requires the Windows workspace backend. "
            "The portable runner only executes dogfood, suggest, bench, languagebench, crosscheck, selftest and composites made from them."
        )
    if verb == "dogfood":
        run_python("mine-hud.py", hud_root)
    elif verb == "suggest":
        run_python("suggest-words.py", hud_root)
    elif verb == "bench":
        run_python("benchmark-hud.py", hud_root)
    elif verb == "languagebench":
        run_python("benchmark-language.py", hud_root)
    elif verb == "crosscheck":
        run_python("crosscheck-hud.py", hud_root)
    elif verb == "selftest":
        run_python("test-all.py")


def main():
    parser = argparse.ArgumentParser(prog="indro.py")
    parser.add_argument("--hud-root", default=os.environ.get("INDRO_EVIDENCE_ROOT", r"D:\hud"))
    parser.add_argument("word", nargs="?", default="learn")
    parser.add_argument("args", nargs="*")
    ns = parser.parse_args()

    if ns.word == "plan":
        if not ns.args:
            raise SystemExit("plan requires a word")
        plan = resolve(ns.args[0])
        print(f"INDRO_PLAN word={ns.args[0]} steps={len(plan)} plan={' -> '.join(plan)}")
        return
    if ns.word == "words":
        defs = definitions()
        for name in sorted(defs):
            print(f"{name:12} {' -> '.join(resolve(name, defs))}")
        return

    plan = resolve(ns.word)
    print(f"INDRO_START word={ns.word} plan={' -> '.join(plan)}")
    for step in plan:
        run_primitive(step, ns.hud_root)
    print(f"INDRO_OK word={ns.word}")


if __name__ == "__main__":
    main()
