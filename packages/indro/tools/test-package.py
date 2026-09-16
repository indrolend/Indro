import json
import hashlib
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
required = [
    "Indro.psm1",
    "indro.py",
    "indro_lang.py",
    "indro_proof.py",
    "words.json",
    "workspaces/workspaces.json",
    "tools/mine-hud.py",
    "tools/benchmark-hud.py",
    "tools/benchmark-language.py",
    "tools/benchmark-compact.py",
    "tools/crosscheck-hud.py",
    "tools/suggest-words.py",
    "tools/test-language.py",
    "tools/test-safety.py",
    "tools/test-miner.py",
    "tools/test-package.py",
    "tools/test-wordgraph.py",
    "tools/test-cli.py",
    "tools/test-compiler.py",
    "tools/test-compact.py",
    "tools/test-determinism.py",
    "tools/test-proof.py",
    "tools/test-all.py",
    "install.ps1",
    "doctor.ps1",
]
for name in required:
    assert os.path.isfile(os.path.join(ROOT, name)), name

words = json.load(open(os.path.join(ROOT, "words.json"), encoding="utf-8"))
blocked = {"commit", "push", "merge", "rebase", "reset", "clean", "release", "publish", "ship"}
for name, definition in words["words"].items():
    for step in definition["steps"]:
        assert step.split()[0] not in blocked, (name, step)

ps = open(os.path.join(ROOT, "Indro.psm1"), encoding="utf8").read()
for needle in ("benchmark-hud.py", "benchmark-language.py", "suggest-words.py", "test-all.py", "Resolve-IndroPlan"):
    assert needle in ps, needle
config = json.load(open(os.path.join(ROOT, "workspaces", "workspaces.json"), encoding="utf-8"))
assert config["evidenceRoot"] == r"D:\hud"
assert "Function:global:" not in ps, "module must not leak one-word functions after Remove-Module"
assert "'commit','push','merge','rebase','reset','clean','release','publish','ship'" in ps
assert "Compile-IndroProgram" in ps
assert "Get-IndroProofPlan" in ps

manifest_path = os.path.join(ROOT, "MANIFEST.json")
assert os.path.isfile(manifest_path), "MANIFEST.json"
manifest = json.load(open(manifest_path, encoding="utf-8"))
listed = {row["path"]: row for row in manifest["files"]}
actual = {}
for base, dirs, files in os.walk(ROOT):
    dirs[:] = [d for d in dirs if d != "__pycache__"]
    for file in files:
        path = os.path.join(base, file)
        rel = os.path.relpath(path, ROOT).replace(os.sep, "/")
        if rel == "MANIFEST.json" or rel.endswith(".pyc"):
            continue
        actual[rel] = path
assert set(listed) == set(actual), (set(listed) - set(actual), set(actual) - set(listed))
for rel, path in actual.items():
    data = open(path, "rb").read()
    row = listed[rel]
    assert row["bytes"] == len(data), rel
    assert row["sha256"] == hashlib.sha256(data).hexdigest(), rel

print("INDRO_TEST PASS package safety/module/manifest invariants")
