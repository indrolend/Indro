#!/usr/bin/env python3
"""Read-only cross-repository convergence checks owned by Indro.

The gauntlet composes repository-owned implementations.  It does not execute
repository scripts other than the bounded Node bridge in this directory and
never writes outside its explicitly selected Indro output directory.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import statistics
import subprocess
import sys
import time
import uuid
from collections import deque
from dataclasses import asdict, dataclass
from typing import Any

SCHEMA = "indro.cross-repository-convergence/v1"


def digest(value: Any) -> str:
    if isinstance(value, bytes):
        data = value
    else:
        data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()


def git(repo: pathlib.Path, *args: str, allow_failure: bool = False) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, timeout=30, check=False,
    )
    if result.returncode and not allow_failure:
        raise RuntimeError(f"git {' '.join(args)} failed for {repo}: {result.stderr.decode(errors='replace').strip()}")
    return result


def repository_snapshot(name: str, expected: pathlib.Path) -> dict[str, Any]:
    expected = expected.resolve()
    root = pathlib.Path(git(expected, "rev-parse", "--show-toplevel").stdout.decode().strip()).resolve()
    if root != expected:
        raise RuntimeError(f"unverified repository root for {name}: expected {expected}, got {root}")
    origin = git(root, "remote", "get-url", "origin", allow_failure=True)
    status = git(root, "status", "--porcelain=v1", "--untracked-files=all").stdout.decode()
    return {
        "name": name,
        "root": str(root),
        "branch": git(root, "branch", "--show-current").stdout.decode().strip(),
        "commit": git(root, "rev-parse", "HEAD").stdout.decode().strip(),
        "origin": origin.stdout.decode().strip() if origin.returncode == 0 else None,
        "dirty": bool(status),
        "status_sha256": digest(status.encode()),
        "status_lines": len(status.splitlines()),
    }


def load_module(path: pathlib.Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load module {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


@dataclass
class PartitionValidation:
    valid: bool
    acceptance_congruent: bool
    transition_congruent: bool
    covers_exactly_once: bool
    operations: dict[str, int]
    defect: dict[str, Any] | None = None
    witness: dict[str, Any] | None = None


def distinguish(dfa: Any, left: int, right: int) -> tuple[list[int] | None, int]:
    """Return a shortest accepting-behaviour witness for two states."""
    queue = deque([(left, right, [])])
    seen = {(left, right)}
    operations = 0
    while queue:
        a, b, word = queue.popleft()
        operations += 1
        if (a in dfa.accept) != (b in dfa.accept):
            return word, operations
        for symbol in dfa.alphabet:
            operations += 1
            pair = (dfa.trans[a][symbol], dfa.trans[b][symbol])
            if pair not in seen:
                seen.add(pair)
                queue.append((pair[0], pair[1], word + [symbol]))
    return None, operations


def validate_partition(dfa: Any, partition: Any) -> PartitionValidation:
    blocks = [tuple(block) for block in partition]
    flat = [state for block in blocks for state in block]
    coverage_ops = len(flat) + dfa.n
    coverage = bool(blocks) and all(blocks) and sorted(flat) == list(range(dfa.n))
    operations = {"coverage": coverage_ops, "acceptance": 0, "transitions": 0, "witness_search": 0}
    if not coverage:
        return PartitionValidation(False, False, False, False, operations, {"kind": "coverage"})
    block_of = {state: index for index, block in enumerate(blocks) for state in block}
    for block_index, block in enumerate(blocks):
        expected = block[0] in dfa.accept
        for state in block[1:]:
            operations["acceptance"] += 1
            if (state in dfa.accept) != expected:
                witness, count = distinguish(dfa, block[0], state)
                operations["witness_search"] += count
                return PartitionValidation(
                    False, False, False, True, operations,
                    {"kind": "acceptance", "block": block_index, "states": [block[0], state]},
                    {"states": [block[0], state], "symbols": witness or [], "length": len(witness or [])},
                )
    for block_index, block in enumerate(blocks):
        representative = block[0]
        for state in block[1:]:
            for symbol in dfa.alphabet:
                operations["transitions"] += 1
                if block_of[dfa.trans[representative][symbol]] != block_of[dfa.trans[state][symbol]]:
                    witness, count = distinguish(dfa, representative, state)
                    operations["witness_search"] += count
                    return PartitionValidation(
                        False, True, False, True, operations,
                        {"kind": "transition", "block": block_index, "states": [representative, state], "symbol": symbol},
                        {"states": [representative, state], "symbols": witness, "length": len(witness) if witness is not None else None},
                    )
    return PartitionValidation(True, True, True, True, operations)


def construct_quotient(dfa: Any, partition: Any) -> tuple[dict[str, Any], int]:
    block_of = {state: index for index, block in enumerate(partition) for state in block}
    transitions = []
    operations = dfa.n
    for block in partition:
        transitions.append([block_of[dfa.trans[block[0]][symbol]] for symbol in dfa.alphabet])
        operations += len(dfa.alphabet)
    accept = [index for index, block in enumerate(partition) if block[0] in dfa.accept]
    operations += len(partition)
    return {"states": len(partition), "transitions": transitions, "accept": accept}, operations


def run_dfa(continuum: Any, trials: int) -> dict[str, Any]:
    fixtures = []
    benchmark = []
    for copies in (1, 4, 16, 64):
        dfa = continuum.refined(seed=8, q=8, copies=copies, alphabet=2)
        start = time.perf_counter_ns()
        partition = continuum.minimize(dfa)  # Continuum remains minimization authority.
        minimize_ns = time.perf_counter_ns() - start
        validation = validate_partition(dfa, partition)
        quotient, construction_ops = construct_quotient(dfa, partition)
        if not validation.valid:
            raise AssertionError("Continuum minimization produced an invalid partition")
        samples = {"full": [], "quotient": [], "validation": [], "construction": [], "query": []}
        query_rounds = 2000
        full_ops = dfa.n * len(dfa.alphabet) * query_rounds
        quotient_query_ops = len(partition) * len(dfa.alphabet) * query_rounds
        for _ in range(trials):
            tick = time.perf_counter_ns()
            accumulator = 0
            for _round in range(query_rounds):
                for state in range(dfa.n):
                    for symbol in dfa.alphabet:
                        accumulator ^= dfa.trans[state][symbol]
            samples["full"].append(time.perf_counter_ns() - tick)
            tick = time.perf_counter_ns()
            component_tick = time.perf_counter_ns()
            check = validate_partition(dfa, partition)
            samples["validation"].append(time.perf_counter_ns() - component_tick)
            component_tick = time.perf_counter_ns()
            built, _ = construct_quotient(dfa, partition)
            samples["construction"].append(time.perf_counter_ns() - component_tick)
            component_tick = time.perf_counter_ns()
            for _round in range(query_rounds):
                for state in range(len(partition)):
                    for symbol in dfa.alphabet:
                        accumulator ^= built["transitions"][state][symbol]
            samples["query"].append(time.perf_counter_ns() - component_tick)
            if not check.valid:
                raise AssertionError("partition changed during benchmark")
            samples["quotient"].append(time.perf_counter_ns() - tick)
        validation_ops = sum(validation.operations.values())
        modeled_full = full_ops
        modeled_quotient = validation_ops + construction_ops + quotient_query_ops
        full_median = int(statistics.median(samples["full"]))
        quotient_median = int(statistics.median(samples["quotient"]))
        benchmark.append({
            "concrete_states": dfa.n, "quotient_states": len(partition), "query_rounds": query_rounds,
            "wall_ns": {"full_median": full_median, "quotient_median": quotient_median,
                        "delta": quotient_median - full_median,
                        "savings_fraction": (full_median - quotient_median) / full_median,
                        "quotient_includes": ["partition_validation", "quotient_construction", "query"],
                        "component_medians": {
                            "validation": int(statistics.median(samples["validation"])),
                            "construction": int(statistics.median(samples["construction"])),
                            "query": int(statistics.median(samples["query"])),
                        }},
            "operation_counts": {"full_query": full_ops, "quotient_query": quotient_query_ops,
                                 "validation": validation_ops, "construction": construction_ops},
            "modeled_cost": {"full": modeled_full, "quotient": modeled_quotient,
                             "delta": modeled_quotient - modeled_full,
                             "savings_fraction": (modeled_full - modeled_quotient) / modeled_full},
            "minimization_wall_ns": minimize_ns,
            "validation": asdict(validation), "quotient_sha256": digest(quotient), "sink": accumulator,
        })
        fixtures.append({"copies": copies, "states": dfa.n, "partition": [list(x) for x in partition]})

    dfa = continuum.refined(seed=8, q=8, copies=4, alphabet=2)
    valid = continuum.minimize(dfa)
    merged = list(map(tuple, valid))
    chosen = None
    for left_index, left in enumerate(merged):
        for right_index in range(left_index + 1, len(merged)):
            word, _ = distinguish(dfa, left[0], merged[right_index][0])
            # Prefer a transition-congruence defect so the retained witness
            # demonstrates more than immediate acceptance disagreement.
            if word:
                chosen = (left_index, right_index)
                break
        if chosen:
            break
    if chosen is None:
        raise AssertionError("fixture has no distinguishable quotient states")
    left_index, right_index = chosen
    invalid = [block for index, block in enumerate(merged) if index not in chosen]
    invalid.append(merged[left_index] + merged[right_index])
    rejected = validate_partition(dfa, invalid)
    if rejected.valid or rejected.witness is None:
        raise AssertionError("invalid merged partition was not rejected with a witness")
    return {
        "minimizer": "Continuum/src/qbench.py:minimize", "fixtures": fixtures,
        "invalid_partition": {"partition": [list(x) for x in invalid], "validation": asdict(rejected)},
        "benchmark": benchmark,
    }


def run_node_bridge(indro: pathlib.Path, ndra: pathlib.Path) -> tuple[dict[str, Any], dict[str, Any]]:
    bridge = indro / "packages" / "indro" / "tools" / "convergence_gauntlet_node.mjs"
    uai = indro / "packages" / "indro" / "uai" / "assay.mjs"
    ndra_module = ndra / "packages" / "commandhud" / "ndra-proof.mjs"
    state = indro / "evidence" / "convergence-gauntlet" / "commandhud-runs" / uuid.uuid4().hex
    command = ["node", str(bridge), str(uai), str(ndra_module), str(indro), str(state)]
    started = time.time_ns()
    tick = time.perf_counter_ns()
    result = subprocess.run(command, cwd=indro, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
    ended = time.time_ns()
    execution = {
        "kind": "verified_execution", "command": command, "cwd": str(indro), "started_utc_ns": started,
        "ended_utc_ns": ended, "wall_ns": time.perf_counter_ns() - tick, "exit_code": result.returncode,
        "stdout_sha256": digest(result.stdout), "stderr_sha256": digest(result.stderr),
        "stdout_bytes": len(result.stdout), "stderr_bytes": len(result.stderr),
    }
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace"))
    return json.loads(result.stdout), execution


def evidence_gate(plan: dict[str, Any], evidence: dict[str, Any]) -> dict[str, Any]:
    accepted, rejected = [], []
    for name in plan["reuse"]:
        item = evidence.get(name)
        reasons = []
        if not isinstance(item, dict):
            reasons.append("MISSING_EVIDENCE")
        else:
            if item.get("fingerprint") != plan["fingerprints"][name]: reasons.append("FINGERPRINT_MISMATCH")
            if item.get("outcome") != "PASS": reasons.append("OUTCOME_NOT_PASS")
            if not item.get("artifact_sha256"): reasons.append("MISSING_ARTIFACT_HASH")
            if item.get("dependency_fingerprints") != {
                dep: plan["fingerprints"][dep] for dep in DEFAULT_GRAPH[name].deps
            }: reasons.append("DEPENDENCY_EVIDENCE_MISMATCH")
        (rejected if reasons else accepted).append({"proof": name, "reasons": reasons})
    if rejected:
        verdict = "NOT_REUSABLE"
    elif plan["run"]:
        verdict = "PARTIAL_REUSE_REQUIRES_EXECUTION"
    else:
        verdict = "REUSABLE"
    return {"accepted": accepted, "rejected": rejected, "verdict": verdict}


DEFAULT_GRAPH: dict[str, Any] = {}


def run_proof_plans(indro: pathlib.Path) -> dict[str, Any]:
    global DEFAULT_GRAPH
    proof = load_module(indro / "packages" / "indro" / "indro_proof.py", "indro_convergence_proof")
    DEFAULT_GRAPH = proof.DEFAULT_GRAPH
    planner = proof.ProofPlanner()
    state = {"source": "s0", "tests": "t0", "config": "c0", "toolchain": "tc0", "runtime": "r0"}
    cold = planner.plan(["verified"], state, {})
    valid_evidence = {}
    for name, fingerprint in cold["fingerprints"].items():
        valid_evidence[name] = {
            "fingerprint": fingerprint, "outcome": "PASS", "artifact_sha256": digest([name, fingerprint]),
            "dependency_fingerprints": {dep: cold["fingerprints"][dep] for dep in planner.graph[name].deps},
        }
    warm = planner.plan(["verified"], state, cold["fingerprints"])
    invalid = json.loads(json.dumps(valid_evidence)); invalid["test"]["outcome"] = "FAIL"
    missing = json.loads(json.dumps(valid_evidence)); del missing["build"]
    changed_state = dict(state, tests="t1")
    changed = planner.plan(["verified"], changed_state, cold["fingerprints"])
    cases = {
        "valid": {"plan": warm, "evidence": evidence_gate(warm, valid_evidence)},
        "invalid": {"plan": warm, "evidence": evidence_gate(warm, invalid)},
        "missing": {"plan": warm, "evidence": evidence_gate(warm, missing)},
        "changed_dependency": {"plan": changed, "evidence": evidence_gate(changed, valid_evidence)},
    }
    return {"planner": "packages/indro/indro_proof.py:ProofPlanner", "cases": cases,
            "policy": "fingerprints select candidates; successful reusable evidence also requires PASS outcome, artifact hash, and exact dependency evidence"}


def run(args: argparse.Namespace) -> dict[str, Any]:
    workspace = args.workspace.resolve()
    roots = {
        "Continuum": workspace / "Continuum", "Indro": workspace / "Indro",
        "Indro-NDRA-Formal-Compare": workspace / "Indro-NDRA-Formal-Compare",
        "workflow-gauntlet": workspace / "workflow-gauntlet",
    }
    snapshots_before = {name: repository_snapshot(name, root) for name, root in roots.items()}
    continuum = load_module(roots["Continuum"] / "src" / "qbench.py", "continuum_qbench")
    dfa = run_dfa(continuum, args.trials)
    assays, execution = run_node_bridge(roots["Indro"], roots["Indro-NDRA-Formal-Compare"])
    proofs = run_proof_plans(roots["Indro"])
    snapshots_after = {name: repository_snapshot(name, root) for name, root in roots.items()}
    external_unchanged = {
        name: snapshots_before[name] == snapshots_after[name]
        for name in roots if name != "Indro"
    }
    claims = {
        "bounded_equivalence": {"kind": "bounded_equivalence", "uai": assays["uai"], "ndra": assays["ndra"]},
        "verified_execution": execution,
        "commandhud_evidence_reuse": assays["evidenceReuse"],
        "reusable_evidence": proofs,
    }
    report = {
        "schema": SCHEMA, "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "repositories_before": snapshots_before, "repositories_after": snapshots_after,
        "external_repositories_unchanged": external_unchanged, "dfa": dfa, "claims": claims,
        "limitations": [
            "DFA results cover deterministic finite fixtures only.",
            "UAI and NDRA equivalence claims are exhaustive only over their declared finite domains.",
            "Verified execution proves that the recorded bounded bridge ran with the recorded bytes and exit code; it does not prove general semantic equivalence.",
            "Proof-planner node evidence remains synthetic; the separate CommandHUD evidence-reuse claim executes and validates a real repository command.",
            "Wall-clock benchmarks are local warm-process measurements and may include scheduler noise.",
            "workflow-gauntlet is inspected for repository identity and preservation only; no repository-owned workload is executed.",
        ],
    }
    return report


def self_test(workspace: pathlib.Path) -> None:
    args = argparse.Namespace(workspace=workspace, trials=1)
    report = run(args)
    assert all(report["external_repositories_unchanged"].values())
    assert report["dfa"]["invalid_partition"]["validation"]["valid"] is False
    assert report["dfa"]["invalid_partition"]["validation"]["witness"] is not None
    assert report["claims"]["bounded_equivalence"]["uai"]["equivalent"]["verdict"] == "PROVEN_EQUIVALENT"
    assert report["claims"]["bounded_equivalence"]["uai"]["mutant"]["verdict"] == "COUNTEREXAMPLE"
    assert report["claims"]["bounded_equivalence"]["ndra"]["equivalent"]["status"] == "BOUNDED_EQUIVALENT"
    assert report["claims"]["bounded_equivalence"]["ndra"]["mutant"]["status"] == "COUNTEREXAMPLE"
    reuse = report["claims"]["commandhud_evidence_reuse"]
    assert reuse["scenarios"]["cold"]["executed"] is True
    assert reuse["scenarios"]["warm"]["skipped"] is True
    assert reuse["scenarios"]["changedInput"]["executed"] is True
    assert reuse["scenarios"]["corrupted"]["valid"] is False
    assert reuse["scenarios"]["repaired"]["executed"] is True
    assert reuse["measurements"]["commandsExecuted"] == 4
    assert reuse["measurements"]["commandsSkipped"] == 1
    cases = report["claims"]["reusable_evidence"]["cases"]
    assert cases["valid"]["evidence"]["verdict"] == "REUSABLE"
    assert cases["invalid"]["evidence"]["verdict"] == "NOT_REUSABLE"
    assert cases["missing"]["evidence"]["verdict"] == "NOT_REUSABLE"
    assert cases["changed_dependency"]["plan"]["run"] == ["test", "smoke", "verified"]
    assert cases["changed_dependency"]["evidence"]["verdict"] == "PARTIAL_REUSE_REQUIRES_EXECUTION"
    print("INDRO_TEST PASS convergence gauntlet")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=pathlib.Path, default=pathlib.Path.home() / "Projects")
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--trials", type=int, default=5)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.trials < 1: parser.error("trials must be positive")
    if args.self_test:
        self_test(args.workspace.resolve())
        return 0
    indro = (args.workspace.resolve() / "Indro")
    output = (args.output or indro / "evidence" / "convergence-gauntlet" / "results.json").resolve()
    try:
        output.relative_to(indro)
    except ValueError:
        parser.error("output must remain inside the verified Indro repository")
    report = run(args)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "sha256": digest(output.read_bytes()),
                      "external_repositories_unchanged": report["external_repositories_unchanged"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
