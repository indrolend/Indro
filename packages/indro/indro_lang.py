#!/usr/bin/env python3
"""Indro language parser and compiler.

Indro source describes software-development intent. Compilation produces a
deterministic, inspectable plan; execution remains the responsibility of a
workspace adapter such as the PowerShell backend.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class IndroError(ValueError):
    pass


EFFECT_ORDER = ("read", "write", "exec", "network", "publish")
EFFECT_CODES = {"r": "read", "w": "write", "x": "exec", "n": "network", "p": "publish"}
WORD_ALIASES = {
    "o": "orient", "a": "audit", "ck": "checkpoint", "v": "verify",
    "b": "build", "t": "test", "s": "smoke", "d": "doctor",
    "p": "prove", "h": "harden", "m": "measure", "l": "learn",
    "st": "status", "df": "diffcheck", "x": "selftest", "sh": "ship",
}
PRIMITIVE_EFFECTS = {
    "status": {"read"}, "audit": {"read"}, "evidence": {"read"},
    "diffcheck": {"read", "exec"}, "doctor": {"read", "exec"},
    "checkpoint": {"read", "write"}, "save": {"read", "write"},
    "build": {"read", "write", "exec"}, "test": {"read", "write", "exec"},
    "smoke": {"read", "write", "exec"}, "play": {"read", "write", "exec"},
    "verify": {"read", "write", "exec"}, "agent": {"read", "write", "exec"},
    "dogfood": {"read", "exec"}, "suggest": {"read", "exec"},
    "bench": {"read", "exec"}, "languagebench": {"read", "exec"},
    "crosscheck": {"read", "exec"}, "selftest": {"read", "exec"},
    "commit": {"read", "write"}, "push": {"read", "network", "publish"},
    "merge": {"read", "write"}, "rebase": {"read", "write"},
    "reset": {"write"}, "clean": {"write"},
    "release": {"read", "write", "exec", "network", "publish"},
    "publish": {"network", "publish"}, "ship": {"read", "write", "exec", "network", "publish"},
}
SENSITIVE_EFFECTS = {"write", "network", "publish"}
CONSEQUENTIAL = {"commit", "push", "merge", "rebase", "reset", "clean", "release", "publish", "ship"}
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_-]*)\}")


@dataclass
class Parameter:
    name: str
    type: str
    default: str | None = None


@dataclass
class Statement:
    kind: str
    value: str = ""
    args: list[str] = field(default_factory=list)
    children: list["Statement"] = field(default_factory=list)
    line: int = 0


@dataclass
class Program:
    name: str
    intent: str = ""
    parameters: dict[str, Parameter] = field(default_factory=dict)
    permits: set[str] = field(default_factory=set)
    flows: dict[str, list[Statement]] = field(default_factory=dict)


def _tokens(text: str, line: int) -> list[str]:
    try:
        return shlex.split(text, posix=True)
    except ValueError as exc:
        raise IndroError(f"line {line}: {exc}") from exc


def _indent(raw: str, line: int) -> int:
    prefix = raw[: len(raw) - len(raw.lstrip(" "))]
    if "\t" in prefix or len(prefix) % 2:
        raise IndroError(f"line {line}: indentation must use multiples of two spaces")
    return len(prefix)


def _expand_syntax(raw: str) -> str:
    """Expand the compact surface syntax without changing indentation."""
    prefix = raw[: len(raw) - len(raw.lstrip(" "))]
    text = raw.strip()
    if text.startswith("#") or not text:
        return raw
    if text.startswith("@"):
        text = "program " + text[1:].strip()
    elif text.startswith("!"):
        text = "intent " + text[1:].strip()
    elif text.startswith("$"):
        text = "param " + text[1:].strip()
    elif text.startswith("+"):
        effects = text[1:].strip()
        if re.fullmatch(r"[rwxnp]+", effects):
            effects = " ".join(EFFECT_CODES[code] for code in effects)
        text = "permit " + effects
    elif text.startswith(":"):
        text = "flow " + text[1:].strip() + ":"
    elif text.startswith(">"):
        text = "do " + text[1:].strip()
    elif text.startswith("?"):
        text = "ensure " + text[1:].strip()
    elif text.startswith("."):
        text = "emit " + text[1:].strip()
    elif text == "||":
        text = "parallel:"
    elif text == "~":
        text = "recover:"
    return prefix + text


def canonical_word(word: str) -> str:
    return WORD_ALIASES.get(word, word)


def parse(source: str) -> Program:
    expanded = [_expand_syntax(raw) for raw in source.splitlines()]
    rows = [(i, _indent(raw, i), raw.strip()) for i, raw in enumerate(expanded, 1)
            if raw.strip() and not raw.lstrip().startswith("#")]
    if not rows:
        raise IndroError("empty program")
    line, indent, head = rows[0]
    parts = _tokens(head, line)
    if indent or len(parts) != 2 or parts[0] != "program" or not NAME_RE.match(parts[1]):
        raise IndroError(f"line {line}: expected 'program NAME'")
    program = Program(parts[1])
    index = 1

    def block(start: int, level: int) -> tuple[list[Statement], int]:
        out: list[Statement] = []
        i = start
        while i < len(rows):
            line_no, depth, text = rows[i]
            if depth < level:
                break
            if depth > level:
                raise IndroError(f"line {line_no}: unexpected indentation")
            words = _tokens(text[:-1] if text.endswith(":") else text, line_no)
            if text.endswith(":"):
                if len(words) != 1 or words[0] not in {"parallel", "recover"}:
                    raise IndroError(f"line {line_no}: unknown block '{text}'")
                children, i = block(i + 1, level + 2)
                if not children:
                    raise IndroError(f"line {line_no}: empty {words[0]} block")
                out.append(Statement(words[0], children=children, line=line_no))
                continue
            if not words:
                i += 1
                continue
            if words[0] == "do" and len(words) >= 2:
                out.append(Statement("do", canonical_word(words[1]), words[2:], line=line_no))
            elif words[0] == "ensure" and len(words) >= 2:
                out.append(Statement("ensure", " ".join(words[1:]), line=line_no))
            elif words[0] == "emit" and len(words) >= 2:
                out.append(Statement("emit", " ".join(words[1:]), line=line_no))
            else:
                raise IndroError(f"line {line_no}: expected do, ensure, emit, parallel:, or recover:")
            i += 1
        return out, i

    while index < len(rows):
        line, depth, text = rows[index]
        if depth:
            raise IndroError(f"line {line}: unexpected indentation")
        words = _tokens(text[:-1] if text.endswith(":") else text, line)
        if words and words[0] == "intent" and len(words) == 2 and not text.endswith(":"):
            program.intent = words[1]
            index += 1
        elif words and words[0] == "param" and not text.endswith(":"):
            match = re.fullmatch(r"param\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([^=\s]+)(?:\s*=\s*(.+))?", text)
            if not match:
                raise IndroError(f"line {line}: invalid parameter declaration")
            name, type_name, default = match.groups()
            if name in program.parameters:
                raise IndroError(f"line {line}: duplicate parameter '{name}'")
            program.parameters[name] = Parameter(name, type_name, default)
            index += 1
        elif words and words[0] == "permit" and len(words) >= 2 and not text.endswith(":"):
            effects = {item for token in words[1:] for item in token.split(",") if item}
            unknown = effects - set(EFFECT_ORDER)
            if unknown:
                raise IndroError(f"line {line}: unknown effects: {', '.join(sorted(unknown))}")
            program.permits |= effects
            index += 1
        elif text.endswith(":") and len(words) == 2 and words[0] == "flow" and NAME_RE.match(words[1]):
            if words[1] in program.flows:
                raise IndroError(f"line {line}: duplicate flow '{words[1]}'")
            body, index = block(index + 1, 2)
            if not body:
                raise IndroError(f"line {line}: empty flow '{words[1]}'")
            program.flows[words[1]] = body
        else:
            raise IndroError(f"line {line}: unknown declaration")
    if not program.intent:
        raise IndroError("program must declare intent")
    if "main" not in program.flows:
        raise IndroError("program must declare 'flow main:'")
    return program


def _coerce(param: Parameter, raw: str) -> Any:
    value = raw.strip()
    kind = param.type
    if kind == "string" or kind == "word":
        return value
    if kind == "path":
        if "\x00" in value:
            raise IndroError(f"parameter '{param.name}' contains NUL")
        return value
    if kind == "integer":
        try:
            return int(value)
        except ValueError as exc:
            raise IndroError(f"parameter '{param.name}' must be an integer") from exc
    if kind == "boolean":
        lowered = value.lower()
        if lowered not in {"true", "false"}:
            raise IndroError(f"parameter '{param.name}' must be true or false")
        return lowered == "true"
    match = re.fullmatch(r"choice\(([^)]+)\)", kind)
    if match:
        choices = match.group(1).split("|")
        if value not in choices:
            raise IndroError(f"parameter '{param.name}' must be one of: {', '.join(choices)}")
        return value
    raise IndroError(f"parameter '{param.name}' has unknown type '{kind}'")


def bind(program: Program, values: dict[str, str]) -> dict[str, Any]:
    unknown = set(values) - set(program.parameters)
    if unknown:
        raise IndroError("unknown parameters: " + ", ".join(sorted(unknown)))
    bound: dict[str, Any] = {}
    for name, param in program.parameters.items():
        raw = values.get(name, param.default)
        if raw is None:
            raise IndroError(f"missing parameter '{name}'")
        bound[name] = _coerce(param, raw)
    return bound


def _expand(text: str, values: dict[str, Any], line: int) -> str:
    def replace(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in values:
            raise IndroError(f"line {line}: unknown parameter '{name}'")
        value = values[name]
        return str(value).lower() if isinstance(value, bool) else str(value)
    return VAR_RE.sub(replace, text)


def load_words(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))["words"]


def resolve_word(word: str, definitions: dict[str, Any], stack: tuple[str, ...] = ()) -> list[str]:
    if word in stack:
        raise IndroError("word cycle: " + " -> ".join(stack + (word,)))
    if word in PRIMITIVE_EFFECTS:
        return [word]
    if word not in definitions:
        raise IndroError(f"unknown word '{word}'")
    result: list[str] = []
    for step in definitions[word]["steps"]:
        tokens = shlex.split(step)
        if len(tokens) > 1:
            if tokens[0] not in PRIMITIVE_EFFECTS:
                raise IndroError(f"argument-bearing composite step is unsupported: {step}")
            result.append(step)
        else:
            result.extend(resolve_word(tokens[0], definitions, stack + (word,)))
    return result


def compile_program(program: Program, values: dict[str, Any], definitions: dict[str, Any],
                    allowed_effects: set[str], entry: str = "main") -> dict[str, Any]:
    if entry not in program.flows:
        raise IndroError(f"unknown flow '{entry}'")
    inferred: set[str] = set()
    nodes: list[dict[str, Any]] = []
    next_id = 0

    def compile_statements(statements: list[Statement], lane: str) -> list[dict[str, Any]]:
        nonlocal next_id
        compiled: list[dict[str, Any]] = []
        for statement in statements:
            next_id += 1
            node_id = f"n{next_id:04d}"
            if statement.kind == "do":
                args = [_expand(arg, values, statement.line) for arg in statement.args]
                primitives = resolve_word(statement.value, definitions)
                expanded = []
                for index, primitive in enumerate(primitives):
                    bits = shlex.split(primitive)
                    verb = bits[0]
                    primitive_args = bits[1:] + (args if index == len(primitives) - 1 else [])
                    effects = PRIMITIVE_EFFECTS[verb]
                    inferred.update(effects)
                    if verb in CONSEQUENTIAL and statement.value != verb:
                        raise IndroError(f"line {statement.line}: consequential '{verb}' is hidden by '{statement.value}'")
                    expanded.append({"word": verb, "args": primitive_args,
                                     "effects": sorted(effects, key=EFFECT_ORDER.index)})
                node = {"id": node_id, "kind": "action", "sourceWord": statement.value,
                        "steps": expanded, "lane": lane, "line": statement.line}
            elif statement.kind in {"ensure", "emit"}:
                node = {"id": node_id, "kind": statement.kind,
                        "value": _expand(statement.value, values, statement.line),
                        "lane": lane, "line": statement.line}
            else:
                branches = compile_statements(statement.children, f"{lane}.{statement.kind}")
                node = {"id": node_id, "kind": statement.kind, "children": branches,
                        "lane": lane, "line": statement.line}
            nodes.append(node)
            compiled.append(node)
        return compiled

    root = compile_statements(program.flows[entry], entry)
    undeclared = inferred - program.permits
    if undeclared:
        raise IndroError("program uses undeclared effects: " + ", ".join(sorted(undeclared, key=EFFECT_ORDER.index)))
    required_authority = inferred & SENSITIVE_EFFECTS
    denied = required_authority - allowed_effects
    if denied:
        raise IndroError("invocation has not allowed effects: " + ", ".join(sorted(denied, key=EFFECT_ORDER.index)))
    plan = {
        "schemaVersion": 1,
        "languageVersion": "0.7.0",
        "program": program.name,
        "entry": entry,
        "intent": _expand(program.intent, values, 0),
        "bindings": values,
        "declaredEffects": sorted(program.permits, key=EFFECT_ORDER.index),
        "inferredEffects": sorted(inferred, key=EFFECT_ORDER.index),
        "nodes": root,
    }
    def semantic(value: Any) -> Any:
        if isinstance(value, dict):
            return {key: semantic(item) for key, item in value.items() if key not in {"line", "lane"}}
        if isinstance(value, list):
            return [semantic(item) for item in value]
        return value
    canonical = json.dumps(semantic(plan), sort_keys=True, separators=(",", ":")).encode()
    plan["planId"] = hashlib.sha256(canonical).hexdigest()[:20]
    return plan


def compact_plan(plan: dict[str, Any]) -> dict[str, Any]:
    effect_code = {value: key for key, value in EFFECT_CODES.items()}

    def node(item: dict[str, Any]) -> list[Any]:
        kind = item["kind"]
        if kind == "action":
            steps = [[step["word"], step["args"], "".join(effect_code[x] for x in step["effects"])]
                     for step in item["steps"]]
            return ["a", item["id"], steps]
        if kind == "ensure":
            return ["?", item["id"], item["value"]]
        if kind == "emit":
            return [".", item["id"], item["value"]]
        return ["||" if kind == "parallel" else "~", item["id"], [node(child) for child in item["children"]]]

    return {
        "v": 1,
        "lv": plan["languageVersion"],
        "id": plan["planId"],
        "p": plan["program"],
        "e": plan["entry"],
        "i": plan["intent"],
        "b": plan["bindings"],
        "fx": "".join(effect_code[x] for x in plan["inferredEffects"]),
        "n": [node(item) for item in plan["nodes"]],
    }


def _sets(items: list[str]) -> dict[str, str]:
    result = {}
    for item in items:
        if "=" not in item:
            raise IndroError(f"expected NAME=VALUE, got '{item}'")
        name, value = item.split("=", 1)
        result[name] = value
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="indro-lang")
    parser.add_argument("source", type=Path)
    parser.add_argument("--words", type=Path, default=Path(__file__).with_name("words.json"))
    parser.add_argument("--entry", default="main")
    parser.add_argument("--set", action="append", default=[], metavar="NAME=VALUE")
    parser.add_argument("--allow-effect", action="append", default=[], choices=EFFECT_ORDER)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--format", choices=("json", "compact"), default="json")
    ns = parser.parse_args(argv)
    try:
        program = parse(ns.source.read_text(encoding="utf-8"))
        values = bind(program, _sets(ns.set))
        plan = compile_program(program, values, load_words(ns.words), set(ns.allow_effect), ns.entry)
    except (OSError, json.JSONDecodeError, IndroError) as exc:
        print(f"INDRO_ERROR {exc}", file=sys.stderr)
        return 2
    if ns.check:
        print(f"INDRO_CHECK PASS program={plan['program']} plan={plan['planId']} effects={','.join(plan['inferredEffects'])}")
    else:
        payload = compact_plan(plan) if ns.format == "compact" else plan
        print(json.dumps(payload, separators=(",", ":") if ns.format == "compact" else None,
                         indent=None if ns.format == "compact" else 2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
