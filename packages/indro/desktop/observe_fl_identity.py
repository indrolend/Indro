"""Independently capture live FL Studio process and Win32 window identity."""

import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

import psutil
import win32gui
import win32process


FL_PATH = os.path.normcase(r"C:\Program Files\Image-Line\FL Studio 2025\FL64.exe")


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def windows_for_process(process_id):
    windows = []

    def children(parent):
        result = []

        def add_child(handle, _context):
            _thread, owner = win32process.GetWindowThreadProcessId(handle)
            if owner == process_id:
                result.append({
                    "handle": handle,
                    "class_name": win32gui.GetClassName(handle),
                    "visible": bool(win32gui.IsWindowVisible(handle)),
                })
            return True

        win32gui.EnumChildWindows(parent, add_child, None)
        return result

    def add_window(handle, _context):
        _thread, owner = win32process.GetWindowThreadProcessId(handle)
        if owner == process_id:
            windows.append({
                "handle": handle,
                "class_name": win32gui.GetClassName(handle),
                "visible": bool(win32gui.IsWindowVisible(handle)),
                "children": children(handle),
            })
        return True

    win32gui.EnumWindows(add_window, None)
    return windows


def observe():
    matches = []
    for process in psutil.process_iter(["pid", "name", "exe", "create_time"]):
        try:
            executable = os.path.normcase(os.path.abspath(process.info.get("exe") or ""))
            if (process.info.get("name") or "").lower() == "fl64.exe" and executable == FL_PATH:
                matches.append(process.info)
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
    if len(matches) != 1:
        raise RuntimeError(f"FL_STUDIO_IDENTITY_COUNT_INVALID:{len(matches)}")
    identity = matches[0]
    # psutil has no Windows session-id property; query the process through kernel32.
    import ctypes
    session = ctypes.c_ulong()
    if not ctypes.windll.kernel32.ProcessIdToSessionId(identity["pid"], ctypes.byref(session)):
        raise RuntimeError("FL_STUDIO_SESSION_ID_UNAVAILABLE")
    windows = windows_for_process(identity["pid"])
    return {
        "process_id": identity["pid"],
        "process_start_unix": identity["create_time"],
        "executable": identity["exe"],
        "executable_sha256": sha256(identity["exe"]),
        "session_id": session.value,
        "windows": windows,
        "window_observation": "current-window-station" if windows else "unavailable-from-current-window-station",
    }


def atomic_json(path, value):
    destination = Path(path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f"{destination.name}.", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    arguments = parser.parse_args()
    value = observe()
    if arguments.output:
        atomic_json(arguments.output, value)
    print(json.dumps(value, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
