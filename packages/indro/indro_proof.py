#!/usr/bin/env python3
"""Content-addressed proof planning for Indro.

The planner never claims a proof is reusable unless its exact semantic inputs
and every dependency proof fingerprint match. It plans; adapters execute.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ProofError(ValueError):
    pass


@dataclass(frozen=True)
class ProofSpec:
    deps: tuple[str, ...]
    inputs: tuple[str, ...]


DEFAULT_GRAPH = {
    "parse": ProofSpec((), ("source", "toolchain")),
    "lint": ProofSpec(("parse",), ("source", "config", "toolchain")),
    "build": ProofSpec(("parse",), ("source", "config", "toolchain")),
    "test": ProofSpec(("build",), ("source", "tests", "config", "toolchain")),
    "smoke": ProofSpec(("build", "test"), ("source", "tests", "config", "toolchain", "runtime")),
    "verified": ProofSpec(("lint", "smoke"), ()),
}


def _digest(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


class ProofPlanner:
    def __init__(self, graph: dict[str, ProofSpec] | None = None):
        self.graph = graph or DEFAULT_GRAPH
        self._validate()

    def _validate(self) -> None:
        visiting: set[str] = set()
        complete: set[str] = set()

        def visit(name: str) -> None:
            if name not in self.graph:
                raise ProofError(f"unknown proof '{name}'")
            if name in visiting:
                raise ProofError(f"proof cycle at '{name}'")
            if name in complete:
                return
            visiting.add(name)
            for dep in self.graph[name].deps:
                visit(dep)
            visiting.remove(name)
            complete.add(name)

        for name in self.graph:
            visit(name)

    def fingerprint(self, name: str, state: dict[str, str], fingerprints: dict[str, str]) -> str:
        spec = self.graph[name]
        missing = set(spec.inputs) - set(state)
        if missing:
            raise ProofError(f"proof '{name}' is missing state: {', '.join(sorted(missing))}")
        return _digest({
            "proof": name,
            "inputs": {key: state[key] for key in spec.inputs},
            "deps": {dep: fingerprints[dep] for dep in spec.deps},
        })

    def plan(self, required: list[str], state: dict[str, str], cache: dict[str, str]) -> dict[str, Any]:
        order: list[str] = []
        fingerprints: dict[str, str] = {}
        reused: list[str] = []
        visiting: set[str] = set()

        def visit(name: str) -> None:
            if name in fingerprints:
                return
            if name not in self.graph:
                raise ProofError(f"unknown proof '{name}'")
            if name in visiting:
                raise ProofError(f"proof cycle at '{name}'")
            visiting.add(name)
            for dep in self.graph[name].deps:
                visit(dep)
            visiting.remove(name)
            fingerprint = self.fingerprint(name, state, fingerprints)
            fingerprints[name] = fingerprint
            if cache.get(name) == fingerprint:
                reused.append(name)
            else:
                order.append(name)

        for name in required:
            visit(name)
        payload = {"required": required, "run": order, "reuse": reused,
                   "fingerprints": fingerprints}
        payload["planId"] = _digest(payload)[:20]
        return payload


def main() -> int:
    parser = argparse.ArgumentParser(prog="indro-proof")
    parser.add_argument("required", nargs="+", help="required proof names")
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--cache", type=Path)
    ns = parser.parse_args()
    state = json.loads(ns.state.read_text(encoding="utf-8"))
    cache = json.loads(ns.cache.read_text(encoding="utf-8")) if ns.cache else {}
    try:
        result = ProofPlanner().plan(ns.required, state, cache)
    except ProofError as exc:
        print(f"INDRO_PROOF_ERROR {exc}")
        return 2
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
