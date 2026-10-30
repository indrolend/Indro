"""Bounded INDRO worker for operations that require the interactive Windows desktop."""

import argparse
import ctypes
import hashlib
import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import psutil
import win32api
import win32con
import win32security
from pywinauto import Desktop
from pywinauto.keyboard import send_keys

SCHEMA = "indro.desktop-control.v1"
FL_PATH = os.path.normcase(r"C:\Program Files\Image-Line\FL Studio 2025\FL64.exe")
ALLOWED = {"fl-studio.browser.observe", "fl-studio.browser.set", "fl-studio.piano-roll.run"}


class MutationOutcomeUnknown(RuntimeError):
    pass


def timestamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    with open(temporary, "x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_session():
    session = ctypes.c_ulong()
    if not ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(session)):
        raise RuntimeError("SESSION_ID_UNAVAILABLE")
    return session.value


def active_console_session():
    value = ctypes.windll.kernel32.WTSGetActiveConsoleSessionId()
    return None if value == 0xFFFFFFFF else value


def request_owned_by_current_user(path):
    security = win32security.GetFileSecurity(str(path), win32security.OWNER_SECURITY_INFORMATION)
    owner = security.GetSecurityDescriptorOwner()
    token = win32security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY)
    current = win32security.GetTokenInformation(token, win32security.TokenUser)[0]
    return win32security.ConvertSidToStringSid(owner) == win32security.ConvertSidToStringSid(current)


def current_user_sid():
    token = win32security.OpenProcessToken(win32api.GetCurrentProcess(), win32con.TOKEN_QUERY)
    current = win32security.GetTokenInformation(token, win32security.TokenUser)[0]
    return win32security.ConvertSidToStringSid(current)


def fl_identity():
    matches = []
    for process in psutil.process_iter(["pid", "name", "exe", "create_time"]):
        try:
            if (process.info.get("name") or "").lower() != "fl64.exe":
                continue
            executable = os.path.normcase(os.path.abspath(process.info.get("exe") or ""))
            if executable == FL_PATH:
                matches.append(process.info)
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
    if not matches:
        raise RuntimeError("FL_STUDIO_NOT_FOUND")
    if len(matches) != 1:
        raise RuntimeError("FL_STUDIO_IDENTITY_AMBIGUOUS")
    identity = matches[0]
    identity["exe_sha256"] = sha256(identity["exe"])
    return identity


def fl_main(identity):
    windows = Desktop(backend="win32").windows(process=identity["pid"])
    mains = [window for window in windows if window.class_name() == "TFruityLoopsMainForm"]
    if len(mains) != 1:
        raise RuntimeError("FL_MAIN_WINDOW_IDENTITY_AMBIGUOUS")
    return mains[0]


def fl_windows(identity):
    main = fl_main(identity)
    browsers = [control for control in main.descendants() if control.class_name() == "TSampleListForm"]
    if len(browsers) != 1:
        raise RuntimeError("FL_BROWSER_IDENTITY_AMBIGUOUS")
    browser = browsers[0]
    return main, browser


def observe_browser():
    identity = fl_identity()
    main, browser = fl_windows(identity)
    return {
        "value": bool(browser.is_visible()),
        "application": {
            "app_id": "fl-studio", "process_id": identity["pid"], "process_start": identity["create_time"],
            "executable": identity["exe"], "executable_sha256": identity["exe_sha256"],
            "session_id": current_session(), "main_handle": main.handle, "main_class": main.class_name(),
            "browser_handle": browser.handle, "browser_class": browser.class_name(),
        },
        "main_enabled": bool(main.is_enabled()),
        "observation_source": "Win32 IsWindowVisible on TSampleListForm",
    }


def set_browser(expected):
    before = observe_browser()
    if before["value"] == expected:
        return {"before": before, "after": before, "mutation_attempted": False, "idempotent": True}
    identity = fl_identity()
    main, _browser = fl_windows(identity)
    if not main.is_enabled():
        raise RuntimeError("FL_MAIN_WINDOW_DISABLED")
    main.set_focus()
    send_keys("%{F8}")
    try:
        deadline = time.monotonic() + 2.5
        after = None
        while time.monotonic() < deadline:
            time.sleep(0.05)
            after = observe_browser()
            if after["value"] == expected:
                break
    except Exception as error:
        raise MutationOutcomeUnknown(f"POST_MUTATION_OBSERVATION_FAILED:{error}") from error
    return {"before": before, "after": after, "mutation_attempted": True, "idempotent": False}


def run_piano_roll(request_id):
    identity = fl_identity()
    main = fl_main(identity)
    if not main.is_enabled():
        raise RuntimeError("FL_MAIN_WINDOW_DISABLED")
    main.set_focus()
    send_keys("{F7}")
    send_keys("^%y")
    marker = f"INDRO_RESULT|{request_id}|"
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        time.sleep(0.05)
        for window in Desktop(backend="win32").windows(process=identity["pid"]):
            try:
                texts = [window.window_text()] + [control.window_text() for control in window.descendants()]
            except Exception:
                continue
            result = next((text for text in texts if marker in text), None)
            if result:
                send_keys("{ENTER}")
                return {
                    "result_text": result,
                    "application": {
                        "app_id": "fl-studio", "process_id": identity["pid"],
                        "process_start": identity["create_time"], "executable": identity["exe"],
                        "executable_sha256": identity["exe_sha256"], "session_id": current_session(),
                    },
                    "trigger": "Piano Roll Run last script again (Ctrl+Alt+Y)",
                }
    raise MutationOutcomeUnknown("PIANO_ROLL_RESULT_TIMEOUT_OUTCOME_UNKNOWN")


def validate_request(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        raise ValueError("REQUEST_SCHEMA_INVALID")
    request_id = value.get("request_id")
    if not isinstance(request_id, str) or len(request_id) != 36:
        raise ValueError("REQUEST_ID_INVALID")
    operation = value.get("operation")
    if operation not in ALLOWED:
        raise ValueError("OPERATION_NOT_AUTHORIZED")
    authorization = value.get("authorization")
    if authorization != {"principal": "local-user", "scope": operation}:
        raise ValueError("AUTHORIZATION_SCOPE_INVALID")
    arguments = value.get("arguments")
    if not isinstance(arguments, dict):
        raise ValueError("ARGUMENTS_INVALID")
    if operation.endswith(".observe") and arguments:
        raise ValueError("OBSERVE_ARGUMENTS_NOT_ALLOWED")
    if operation.endswith(".set") and (set(arguments) != {"value"} or not isinstance(arguments["value"], bool)):
        raise ValueError("SET_ARGUMENTS_INVALID")
    if operation == "fl-studio.piano-roll.run":
        script_request_id = arguments.get("request_id")
        if set(arguments) != {"request_id"} or not isinstance(script_request_id, str) or len(script_request_id) != 36:
            raise ValueError("PIANO_ROLL_ARGUMENTS_INVALID")
    return request_id, operation, arguments


def handle(value):
    request_id, operation, arguments = validate_request(value)
    if operation == "fl-studio.browser.observe":
        result = {"observation": observe_browser(), "mutation_attempted": False}
    elif operation == "fl-studio.browser.set":
        result = set_browser(arguments["value"])
    else:
        result = run_piano_roll(arguments["request_id"])
    return {
        "schema": SCHEMA, "request_id": request_id, "ok": True, "operation": operation,
        "worker": {"pid": os.getpid(), "session_id": current_session()},
        "result": result, "completed_at": timestamp(),
    }


def worker(root):
    session = current_session()
    console = active_console_session()
    if console is None or session != console:
        raise RuntimeError(f"INTERACTIVE_DESKTOP_SESSION_REQUIRED worker={session} console={console}")
    root.mkdir(parents=True, exist_ok=True)
    requests = root / "requests"
    processing = root / "processing"
    responses = root / "responses"
    for directory in (requests, processing, responses):
        directory.mkdir(parents=True, exist_ok=True)
    lock = root / "worker.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            previous = int(lock.read_text(encoding="utf-8").strip())
            if psutil.pid_exists(previous):
                raise RuntimeError(f"WORKER_ALREADY_RUNNING pid={previous}")
        except ValueError:
            pass
        lock.unlink(missing_ok=True)
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(descriptor, str(os.getpid()).encode("ascii"))
    os.close(descriptor)
    try:
        python_hash = sha256(sys.executable)
        worker_script = str(Path(__file__).resolve())
        worker_hash = sha256(worker_script)
        heartbeat_due = 0.0
        while True:
            now = time.monotonic()
            if now >= heartbeat_due:
                atomic_json(root / "worker.json", {
                    "schema": SCHEMA, "pid": os.getpid(), "session_id": session,
                    "owner_sid": current_user_sid(),
                    "active_console_session_id": console, "heartbeat_at": timestamp(),
                    "python": sys.executable, "python_sha256": python_hash,
                    "worker_script": worker_script, "worker_sha256": worker_hash,
                    "operations": sorted(ALLOWED),
                })
                heartbeat_due = now + 1.0
            for source in sorted(requests.glob("*.json")):
                claimed = processing / source.name
                try:
                    os.replace(source, claimed)
                except FileNotFoundError:
                    continue
                request_id = source.stem
                try:
                    if not request_owned_by_current_user(claimed):
                        raise PermissionError("REQUEST_OWNER_INVALID")
                    value = json.loads(claimed.read_text(encoding="utf-8"))
                    response = handle(value)
                    request_id = response["request_id"]
                except Exception as error:
                    response = {
                        "schema": SCHEMA, "request_id": request_id, "ok": False,
                        "error": str(error), "error_type": type(error).__name__,
                        "outcome_unknown": isinstance(error, MutationOutcomeUnknown),
                        "worker": {"pid": os.getpid(), "session_id": session},
                        "completed_at": timestamp(),
                    }
                atomic_json(responses / f"{request_id}.json", response)
                claimed.unlink(missing_ok=True)
            time.sleep(0.02)
    finally:
        lock.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    arguments = parser.parse_args()
    try:
        worker(Path(arguments.root).resolve())
    except Exception:
        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

