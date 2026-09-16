"""Mine a CommandHUD evidence store into compact workflow signals.

The miner intentionally retains only a small summary for each run. CommandHUD
run.json files can contain megabytes of reduced output; retaining every full
JSON document made the first dogfood miner use >1 GiB on the 863-run corpus.
"""
import argparse
import collections
import datetime as dt
import glob
import json
import ntpath
import os
import re
import shlex
import statistics

DEFAULT_GAP_SECONDS = 10 * 60


def resolve_root(root):
    root = os.path.abspath(root)
    for candidate in (root, os.path.join(root, "hud")):
        if os.path.isdir(os.path.join(candidate, "runs")):
            return candidate
    return root


def parse_time(value):
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def unwrap_shell(command):
    """Peel common shell wrappers so family classification sees the payload."""
    c = (command or "").strip()
    shell_path = r'(?:"?[A-Za-z]:\\[^"\r\n]*?\\)?'
    for _ in range(3):
        m = re.match(
            r"^" + shell_path + r"(?:powershell|pwsh)(?:\.exe)?\"?\b.*?\s-(?:command|c)\s+(.+)$",
            c,
            flags=re.I | re.S,
        )
        if m:
            c = m.group(1).strip()
            if len(c) >= 2 and c[0] == c[-1] and c[0] in "\"'":
                c = c[1:-1].strip()
            continue
        m = re.match(
            r"^" + shell_path + r"cmd(?:\.exe)?\"?\b.*?\s/(?:c|k)\s+(.+)$",
            c,
            flags=re.I | re.S,
        )
        if m:
            c = m.group(1).strip()
            if len(c) >= 2 and c[0] == c[-1] and c[0] in "\"'":
                c = c[1:-1].strip()
            continue
        break
    return c


def split_command(command):
    c = unwrap_shell(command)
    if not c:
        return []
    try:
        return shlex.split(c, posix=False)
    except ValueError:
        return c.split()


def tool(command):
    c = unwrap_shell(command).strip()
    if not c:
        return ""
    # CommandHUD contains unquoted absolute Windows executables such as
    # C:\Program Files\nodejs\node.exe --version. shlex splits these at the
    # space, so recognize the executable suffix before tokenization.
    match = re.match(r'^[A-Za-z]:\\.*?\\([^\\\r\n]+?\.(?:exe|cmd|bat))(?=\s|$)', c, flags=re.I)
    if match:
        return ntpath.basename(match.group(1)).lower()
    parts = split_command(c)
    if not parts:
        return ""
    raw = parts[0].strip("\"'")
    return ntpath.basename(raw).lower()

def git_subcommand(command):
    parts = split_command(command)
    if not parts or ntpath.basename(parts[0].strip("\"'")).lower() not in ("git", "git.exe"):
        return None
    i = 1
    # Skip common git global options and their values conservatively.
    while i < len(parts):
        p = parts[i].strip("\"'")
        if p in ("-C", "-c", "--git-dir", "--work-tree") and i + 1 < len(parts):
            i += 2
            continue
        if p in ("--version", "-v"):
            return "version"
        if p.startswith("-"):
            i += 1
            continue
        return p.lower()
    return "other"



def family_from(command, status="", fail_kind=""):
    c = unwrap_shell(command)
    low = c.lower().strip()
    t = tool(c)

    if str(status).lower() == "fail" and fail_kind == "command-not-found":
        return "invalid-command"
    if str(status).lower() == "fail" and (low.startswith("+") or low.startswith("-") or low.startswith("$") or low.startswith("@@")):
        return "shell-fragment"

    sub = git_subcommand(c)
    if sub:
        return "git:" + sub

    if t in ("rg", "rg.exe", "grep", "grep.exe", "select-string", "findstr", "findstr.exe"):
        return "search"
    if t in ("get-content", "cat", "type", "more", "head", "tail", "get-childitem", "get-item", "ls", "dir"):
        return "inspect"
    if t in ("diff", "fc", "compare-object"):
        return "compare"
    if re.search(r"\b(?:set-content|add-content|out-file|writealltext|writeallbytes|appendalltext)\b", low):
        return "edit"
    if low.startswith("##") or re.match(r"^[a-z_][a-z0-9_]*=(?:pass|fail|true|false|\d+)(?:\s|$)", low):
        return "marker"
    if re.match(r"^(?:\$|\(|@\(|\[|if\b|foreach\b|for\b|while\b|try\b|function\b|&\s)", low):
        return "shell-script"
    if t in ("write-output", "write-host", "echo"):
        return "shell-output"
    if t in ("start-sleep", "sleep", "timeout", "timeout.exe"):
        return "wait"
    if t == "run_logged":
        if re.search(r"test|verify|multiplayer|determin|isolation|transition", low):
            return "test"
        return "run-logged"
    if (
        t in ("ctest", "ctest.exe", "pytest", "pytest.exe")
        or re.search(r"\b(?:npm(?:\.cmd)?|pnpm|yarn)\s+(?:run\s+)?test\b", low)
        or re.search(r"\bnode(?:\.exe)?\s+--test\b", low)
        or re.search(r"\b(?:vitest|jest|mocha)\b", low)
        or re.search(r"(?:^|[\\/])[^\\/\s]*(?:test|tests)(?:\.exe)?(?:\s|$)", low)
    ):
        return "test"
    if (
        t in ("cmake", "cmake.exe", "msbuild", "msbuild.exe", "ninja", "ninja.exe")
        or re.search(r"\b(?:build|compile)\b", low)
    ):
        return "build"
    if re.search(r"\b(?:smoke|smoke-test)\b", low):
        return "smoke"
    if t in ("digitalbreakdown.exe", "digitalbreakdown"):
        return "runtime"
    if t in ("curl", "curl.exe", "wget", "wget.exe", "invoke-webrequest"):
        return "network"
    if t in ("python", "python.exe", "py", "node", "node.exe", "npm", "npm.cmd", "pnpm", "yarn"):
        return t.replace(".exe", "").replace(".cmd", "")
    if t in ("powershell", "powershell.exe", "pwsh", "pwsh.exe"):
        return "shell"
    if re.match(r"^[A-Z][A-Z0-9_]{4,}(?:\s|$)", c):
        return "marker"
    return t or "other"

PREFIX_BYTES = 256 * 1024


def _json_string_field(text, name, default=""):
    # Match the first field occurrence even when its value is null. The older
    # implementation matched only string-valued occurrences, so a top-level
    # `request: null` could be skipped and a later nested `request` string
    # mistaken for top-level metadata.
    pattern = r'"' + re.escape(name) + r'"\s*:\s*(null|"(?:\\.|[^"\\])*")'
    match = re.search(pattern, text, flags=re.S)
    if not match or match.group(1) == "null":
        return default
    try:
        value = json.loads(match.group(1))
        return value if isinstance(value, str) else default
    except Exception:
        return default


def _json_number_field(text, name, default=0):
    match = re.search(r'"' + re.escape(name) + r'"\s*:\s*(-?\d+(?:\.\d+)?)', text)
    if not match:
        return default
    try:
        return int(float(match.group(1)))
    except ValueError:
        return default


def _object_prefix(text, name, stop_names=(), limit=16384):
    marker = re.search(r'"' + re.escape(name) + r'"\s*:\s*', text)
    if not marker:
        return ""
    start = marker.end()
    end = min(len(text), start + limit)
    for stop in stop_names:
        found = re.search(r'"' + re.escape(stop) + r'"\s*:', text[start:end])
        if found:
            end = start + found.start()
            break
    return text[start:end]


def summarize_prefix(path):
    """Extract only the metadata Indro needs from the front of run.json.

    CommandHUD preserves bounded/raw evidence inside run.json. Three historical
    stress-test records are 21 MiB, 201 MiB and 501 MiB. Their useful metadata
    occurs in the first few KiB, so parsing the whole document is unnecessary
    and made dogfood mining consume >1 GiB RAM.
    """
    with open(path, "rb") as handle:
        raw = handle.read(PREFIX_BYTES)
    text = raw.decode("utf-8-sig", errors="replace")
    project = _json_string_field(text, "project", "")
    command = _json_string_field(text, "command", "")
    status = _json_string_field(text, "status", "").lower()
    started = _json_string_field(text, "startedAt", "")
    root = _json_string_field(text, "root", "") or _json_string_field(text, "cwd", "")
    objective = _json_string_field(text, "objective", "")
    request = _json_string_field(text, "request", "")
    ident = _json_string_field(text, "id", "") or os.path.basename(os.path.dirname(path))
    if not project or not status or not started:
        raise ValueError("required CommandHUD metadata missing from run.json prefix")

    captured = _object_prefix(text, "capturedFailure", ("dirtyBefore",), 8192)
    fail_kind = _json_string_field(captured, "kind", "")
    fail_class = _json_string_field(captured, "classification", "")
    if status == "fail" and not fail_class:
        reduction = _object_prefix(text, "reduction", ("evidence", "capture", "provenance"), 32768)
        fail_class = _json_string_field(reduction, "classification", "") or "unknown"

    return {
        "id": ident,
        "path": path,
        "project": project,
        "root": root or "?",
        "status": status,
        "command": command,
        "objective": objective,
        "request": request,
        "tool": tool(command),
        "family": family_from(command, status, fail_kind),
        "startedAt": started,
        "time": parse_time(started),
        "durationMs": _json_number_field(text, "durationMs", 0),
        "failureClassification": fail_class if status == "fail" else "",
        "failureKind": fail_kind if status == "fail" else "",
    }


def load_runs(root):
    paths = glob.glob(os.path.join(root, "runs", "*", "*", "run.json"))
    runs, malformed = [], []
    payload_bytes = 0
    bytes_read = 0
    for path in paths:
        try:
            size = os.path.getsize(path)
            payload_bytes += size
            bytes_read += min(size, PREFIX_BYTES)
            runs.append(summarize_prefix(path))
        except Exception as exc:
            malformed.append((path, str(exc)))
    return runs, malformed, payload_bytes, bytes_read

def sessionize(runs, gap_seconds=DEFAULT_GAP_SECONDS):
    groups = collections.defaultdict(list)
    for run in runs:
        groups[(run["project"], run["root"])].append(run)
    sessions = []
    for key, group in groups.items():
        group.sort(key=lambda r: (r["time"] is None, r["time"] or dt.datetime.max.replace(tzinfo=dt.timezone.utc), r["id"]))
        current, previous_time = [], None
        for run in group:
            now = run["time"]
            split = bool(
                current
                and previous_time is not None
                and now is not None
                and (now - previous_time).total_seconds() > gap_seconds
            )
            if split:
                sessions.append(current)
                current = []
            current.append(run)
            previous_time = now
        if current:
            sessions.append(current)
    sessions.sort(key=lambda s: (s[0]["time"] is None, s[0]["time"] or dt.datetime.max.replace(tzinfo=dt.timezone.utc)))
    return sessions


def count_ngrams(sessions, n):
    counter = collections.Counter()
    for session in sessions:
        families = [r["family"] for r in session]
        for i in range(len(families) - n + 1):
            gram = tuple(families[i : i + n])
            counter[gram] += 1
    return counter


def compact_ngrams(counter, limit=20, suppress_repeats=False):
    rows = []
    for gram, count in counter.most_common():
        if suppress_repeats and len(set(gram)) == 1:
            continue
        rows.append({"sequence": list(gram), "count": count})
        if len(rows) >= limit:
            break
    return rows



PHASE_INSPECT = {"search", "inspect", "git:grep", "git:log", "git:show", "git:ls-files"}
PHASE_ORIENT = {"git:status", "git:rev-parse"}
PHASE_COMPARE = {"git:diff", "compare"}
PHASE_RUNTIME = {"smoke", "runtime"}
PHASE_SYNC = {"git:fetch", "git:pull"}
PHASE_TOOL = {"node", "npm", "python"}

def phase_from_family(family):
    """Collapse concrete terminal families into Indro-level semantic phases.

    This is deliberately lossy. Dogfood showed that exact command-family motifs
    overfit individual projects, while semantic phases transfer better across
    projects and time.
    """
    if family in PHASE_ORIENT:
        return "orient"
    if family in PHASE_INSPECT:
        return "inspect"
    if family in PHASE_COMPARE:
        return "compare"
    if family == "edit":
        return "modify"
    if family == "build":
        return "build"
    if family == "test":
        return "test"
    if family in PHASE_RUNTIME:
        return "runtime"
    if family in PHASE_SYNC:
        return "sync"
    if family.startswith("git:"):
        return "vcs"
    if family in PHASE_TOOL:
        return "tool"
    return family

def phase_sessions(sessions, collapse_repeats=True):
    """Return session traces as semantic phases while retaining project support."""
    traces = []
    for session in sessions:
        phases = []
        for run in session:
            value = phase_from_family(run["family"])
            if collapse_repeats and phases and phases[-1] == value:
                continue
            phases.append(value)
        if phases:
            traces.append({"project": session[0]["project"], "phases": phases})
    return traces

def discover_motifs(traces, min_n=2, max_n=4, min_support=3, min_projects=2):
    """Rank repeated semantic motifs by the command tokens they could compress."""
    counts = collections.Counter()
    projects = collections.defaultdict(set)
    for trace in traces:
        values = trace["phases"]
        project = trace["project"]
        for n in range(min_n, max_n + 1):
            for i in range(len(values) - n + 1):
                motif = tuple(values[i:i+n])
                if len(set(motif)) < 2:
                    continue
                counts[motif] += 1
                projects[motif].add(project)
    rows = []
    for motif, count in counts.items():
        project_count = len(projects[motif])
        if count < min_support or project_count < min_projects:
            continue
        rows.append({
            "sequence": list(motif),
            "count": count,
            "projects": project_count,
            "projectNames": sorted(projects[motif]),
            "grossSavings": (len(motif) - 1) * count,
        })
    rows.sort(key=lambda row: (row["grossSavings"], row["projects"], len(row["sequence"]), row["count"]), reverse=True)
    return rows

def compression_stats(traces, motifs):
    """Greedily replace known motifs with one word and report token reduction."""
    patterns = [tuple(row["sequence"] if isinstance(row, dict) else row) for row in motifs]
    patterns.sort(key=len, reverse=True)
    before = after = hits = 0
    hit_counts = collections.Counter()
    for trace in traces:
        values = trace["phases"]
        before += len(values)
        i = 0
        while i < len(values):
            match = next((pattern for pattern in patterns if tuple(values[i:i+len(pattern)]) == pattern), None)
            if match:
                after += 1
                hits += 1
                hit_counts[match] += 1
                i += len(match)
            else:
                after += 1
                i += 1
    return {
        "before": before,
        "after": after,
        "hits": hits,
        "saved": before - after,
        "reduction": (before - after) / before if before else 0.0,
        "hitCounts": [(list(k), v) for k, v in hit_counts.most_common()],
    }


WORKFLOW_NOISE = {"shell-output", "wait", "marker", "invalid-command", "shell-fragment", "shell-script", "shell", "git:version"}


def semantic_sessions(sessions):
    result = []
    for session in sessions:
        filtered = [r for r in session if r["family"] not in WORKFLOW_NOISE]
        if filtered:
            result.append(filtered)
    return result

def analyze(runs, malformed, payload_bytes=0, bytes_read=0, gap_seconds=DEFAULT_GAP_SECONDS):
    status = collections.Counter(r["status"] for r in runs)
    tools = collections.Counter(r["tool"] for r in runs if r["tool"])
    families = collections.Counter(r["family"] for r in runs)
    projects = collections.Counter(r["project"] for r in runs)
    failure_classes = collections.Counter(r["failureClassification"] for r in runs if r["status"] == "fail")
    failure_kinds = collections.Counter(r["failureKind"] for r in runs if r["status"] == "fail" and r["failureKind"])
    generic_objectives = {"Run terminal command with PowerShell", "CommandHud interactive command"}
    objective_present = sum(1 for r in runs if r.get("objective"))
    objective_generic = sum(1 for r in runs if r.get("objective") in generic_objectives)
    objective_meaningful = sum(1 for r in runs if r.get("objective") and r.get("objective") not in generic_objectives)
    objective_missing = len(runs) - objective_present

    sessions = sessionize(runs, gap_seconds)
    pairs = count_ngrams(sessions, 2)
    triples = count_ngrams(sessions, 3)
    semantic = semantic_sessions(sessions)
    phases = phase_sessions(semantic)
    semantic_motifs = discover_motifs(phases, min_n=2, max_n=4, min_support=3, min_projects=2)
    workflow_pairs = count_ngrams(semantic, 2)
    workflow_triples = count_ngrams(semantic, 3)
    next_after_failure = collections.Counter()
    first_pass_after_failure = collections.Counter()
    recovery_actions = collections.Counter()
    by_failure_class = collections.defaultdict(collections.Counter)
    for session in sessions:
        for i, run in enumerate(session):
            if run["status"] != "fail":
                continue
            if i + 1 < len(session):
                nxt = session[i + 1]["family"]
                next_after_failure[nxt] += 1
                by_failure_class[run["failureClassification"]][nxt] += 1
            for follower in session[i + 1 : i + 6]:
                if follower["family"] not in WORKFLOW_NOISE:
                    recovery_actions[follower["family"]] += 1
                    break
            for follower in session[i + 1 : i + 4]:
                if follower["status"] == "pass":
                    first_pass_after_failure[follower["family"]] += 1
                    break

    lengths = [len(s) for s in sessions]
    return {
        "runs": len(runs),
        "projects": len(projects),
        "malformed": len(malformed),
        "payloadBytes": payload_bytes,
        "bytesRead": bytes_read,
        "status": dict(status),
        "tools": tools.most_common(20),
        "families": families.most_common(20),
        "sessionGapSeconds": gap_seconds,
        "sessions": len(sessions),
        "multiRunSessions": sum(1 for s in sessions if len(s) > 1),
        "medianSessionLength": statistics.median(lengths) if lengths else 0,
        "maxSessionLength": max(lengths) if lengths else 0,
        "pairs": compact_ngrams(pairs, 25),
        "triples": compact_ngrams(triples, 25),
        "workflowPairs": compact_ngrams(workflow_pairs, 20, suppress_repeats=True),
        "workflowTriples": compact_ngrams(workflow_triples, 20, suppress_repeats=True),
        "semanticMotifs": semantic_motifs[:20],
        "afterFailure": next_after_failure.most_common(15),
        "recoveryActions": recovery_actions.most_common(15),
        "firstPassAfterFailure": first_pass_after_failure.most_common(15),
        "failureClassifications": failure_classes.most_common(),
        "failureKinds": failure_kinds.most_common(),
        "intentSignal": {
            "meaningful": objective_meaningful,
            "generic": objective_generic,
            "missing": objective_missing,
            "meaningfulFraction": objective_meaningful / len(runs) if runs else 0.0,
        },
        "afterFailureByClass": {
            key: value.most_common(8) for key, value in sorted(by_failure_class.items())
        },
        "projectRuns": projects.most_common(),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=r"D:\hud")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--session-gap", type=int, default=DEFAULT_GAP_SECONDS, help="session gap in seconds")
    ns = parser.parse_args()
    root = resolve_root(ns.root)
    runs, bad, payload_bytes, bytes_read = load_runs(root)
    result = analyze(runs, bad, payload_bytes, bytes_read, ns.session_gap)
    if ns.json:
        print(json.dumps({"root": root, **result}, indent=2))
        return
    print(
        f"INDRO_DOGFOOD root={root} runs={result['runs']} projects={result['projects']} "
        f"sessions={result['sessions']} malformed={result['malformed']}"
    )
    print("STATUS", " ".join(f"{k}={v}" for k, v in sorted(result["status"].items())))
    intent = result["intentSignal"]
    print(
        "INTENT",
        f"meaningful={intent['meaningful']} generic={intent['generic']} missing={intent['missing']} "
        f"meaningful_fraction={intent['meaningfulFraction']:.3f}",
    )
    print("FAMILIES", " ".join(f"{k}={v}" for k, v in result["families"][:15]))
    print("FAILURES", " ".join(f"{k}={v}" for k, v in result["failureClassifications"][:10]))
    print("AFTER_FAIL", " ".join(f"{k}={v}" for k, v in result["afterFailure"][:10]))
    print("RECOVERY", " ".join(f"{k}={v}" for k, v in result["recoveryActions"][:10]))
    print(
        "WORKFLOWS",
        " ".join(
            f"{'>'.join(row['sequence'])}={row['count']}" for row in result["workflowTriples"][:8]
        ),
    )
    print(
        "SEMANTIC_MOTIFS",
        " ".join(
            f"{'>'.join(row['sequence'])}={row['count']}@{row['projects']}p" for row in result["semanticMotifs"][:8]
        ),
    )


if __name__ == "__main__":
    main()
