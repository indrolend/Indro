# name=FL Granulizer Bridge
# receiveFrom=FL-Granulizer-Bridge

"""INDRO-owned FL Studio adapter.

FL Studio is the only state authority. The mailbox transports bounded commands;
it does not maintain project state. One request is processed per OnIdle callback.
"""

import json
import os
import time

import channels
import device
import patterns
import plugins
import transport

BRIDGE_SCHEMA = "indro.fl.bridge.v1"
BRIDGE_VERSION = "1"
ROOT = os.path.join(
    os.path.expanduser("~"), "Documents", "Image-Line", "FL Studio",
    "Settings", "Hardware", "FL Granulizer Bridge", "indro-mailbox"
)
REQUESTS = os.path.join(ROOT, "requests")
RESPONSES = os.path.join(ROOT, "responses")
SESSION_PATH = os.path.join(ROOT, "session.json")
SESSION_ID = "%s-%s" % (os.getpid(), int(time.time() * 1000))
LAST_HEARTBEAT = 0.0


def _mkdir(path):
    if not os.path.isdir(path):
        os.makedirs(path)


def _write_json(path, value):
    # FL Studio scripting v40 ships a reduced frozen os module where replace()
    # is unusable. A response filename is unique and is read only after close.
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, sort_keys=True, separators=(",", ":"))
        handle.flush()


def _session():
    return {
        "schema": BRIDGE_SCHEMA,
        "bridge_version": BRIDGE_VERSION,
        "session_id": SESSION_ID,
        "process_id": os.getpid(),
        "device_assigned": bool(device.isAssigned()),
        "heartbeat_unix_ms": int(time.time() * 1000),
    }


def _channel_identity(index):
    count = channels.channelCount()
    if not isinstance(index, int) or index < 0 or index >= count:
        raise ValueError("INVALID_CHANNEL")
    valid = bool(plugins.isValid(index))
    return {
        "channel": index,
        "channel_name": channels.getChannelName(index),
        "plugin_valid": valid,
        "plugin_name": plugins.getPluginName(index) if valid else None,
    }


def _parameter(index, parameter):
    identity = _channel_identity(index)
    if not identity["plugin_valid"]:
        raise ValueError("NO_PLUGIN")
    count = plugins.getParamCount(index)
    if not isinstance(parameter, int) or parameter < 0 or parameter >= count:
        raise ValueError("INVALID_PARAMETER")
    return {
        **identity,
        "parameter": parameter,
        "parameter_name": plugins.getParamName(parameter, index),
        "value": plugins.getParamValue(parameter, index),
        "parameter_count": count,
    }


def _target_matches(request, identity):
    target = request.get("target") or {}
    if target.get("channel") != identity["channel"]:
        raise ValueError("WRONG_CHANNEL_IDENTITY")
    expected = target.get("plugin_name")
    if expected is not None and expected != identity["plugin_name"]:
        raise ValueError("WRONG_PLUGIN_IDENTITY")


def _execute(request):
    operation = request.get("operation")
    arguments = request.get("arguments") or {}

    if operation in ("ping", "status"):
        selected = channels.selectedChannel()
        identity = _channel_identity(selected) if selected >= 0 else None
        return {
            "bridge": _session(),
            "selected": identity,
            "pattern": {
                "pattern": patterns.patternNumber(),
                "pattern_name": patterns.getPatternName(patterns.patternNumber()),
                "length_beats": patterns.getPatternLength(patterns.patternNumber()),
            },
            "channel_count": channels.channelCount(),
            "playing": bool(transport.isPlaying()),
        }

    if operation == "channels.list":
        return {
            "selected_channel": channels.selectedChannel(),
            "channels": [_channel_identity(i) for i in range(channels.channelCount())],
        }

    if operation == "transport.status":
        return {"playing": bool(transport.isPlaying())}

    if operation in ("transport.play", "transport.stop"):
        if request.get("authorization") != "explicit-user-write":
            raise PermissionError("WRITE_NOT_AUTHORIZED")
        before = bool(transport.isPlaying())
        requested = operation == "transport.play"
        if before != requested:
            if requested:
                transport.start()
            else:
                transport.stop()
        return {
            "before": {"playing": before},
            "requested": requested,
            "readback": {"playing": bool(transport.isPlaying())},
        }

    channel = arguments.get("channel")
    identity = _channel_identity(channel)
    _target_matches(request, identity)

    if operation in ("plugins.list", "plugin.inspect"):
        if operation == "plugins.list":
            values = []
            for i in range(channels.channelCount()):
                item = _channel_identity(i)
                if item["plugin_valid"]:
                    values.append(item)
            return {"plugins": values}
        return {**identity, "parameter_count": plugins.getParamCount(channel) if identity["plugin_valid"] else 0}

    if operation == "plugin.params":
        if not identity["plugin_valid"]:
            raise ValueError("NO_PLUGIN")
        count = plugins.getParamCount(channel)
        return {
            **identity,
            "parameter_count": count,
            "parameters": [
                {
                    "index": i,
                    "name": plugins.getParamName(i, channel),
                    "value": plugins.getParamValue(i, channel),
                }
                for i in range(count)
            ],
        }

    parameter = arguments.get("parameter")
    before = _parameter(channel, parameter)
    if operation == "plugin.get":
        return before

    if operation == "plugin.set":
        if request.get("authorization") != "explicit-user-write":
            raise PermissionError("WRITE_NOT_AUTHORIZED")
        value = arguments.get("value")
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0.0 or value > 1.0:
            raise ValueError("VALUE_OUT_OF_RANGE")
        plugins.setParamValue(float(value), parameter, channel)
        after = _parameter(channel, parameter)
        return {"before": before, "requested": value, "readback": after}

    raise ValueError("UNKNOWN_OPERATION")


def _process(path):
    name = os.path.basename(path)
    transaction_id = name[:-5] if name.endswith(".json") else name
    response_path = os.path.join(RESPONSES, transaction_id + ".json")
    if os.path.exists(response_path):
        os.remove(path)
        return
    received = int(time.time() * 1000)
    response = {
        "schema": BRIDGE_SCHEMA,
        "bridge_version": BRIDGE_VERSION,
        "session_id": SESSION_ID,
        "transaction_id": transaction_id,
        "received_unix_ms": received,
        "accepted": False,
        "executed": False,
    }
    try:
        with open(path, "r", encoding="utf-8") as handle:
            request = json.load(handle)
        if request.get("schema") != BRIDGE_SCHEMA:
            raise ValueError("UNSUPPORTED_SCHEMA")
        if request.get("transaction_id") != transaction_id:
            raise ValueError("TRANSACTION_ID_MISMATCH")
        if request.get("session_id") != SESSION_ID:
            raise ValueError("STALE_OR_WRONG_SESSION")
        response["accepted"] = True
        response["result"] = _execute(request)
        response["executed"] = True
    except Exception as error:
        response["error"] = "%s:%s" % (type(error).__name__, str(error))
    response["completed_unix_ms"] = int(time.time() * 1000)
    _write_json(response_path, response)


def _pending_requests():
    # FL Studio's frozen Python 3.9 build can raise SystemError from
    # os.remove().  Responses are immutable and transaction-addressed, so an
    # existing response is also the durable processed marker.
    return sorted(
        name for name in os.listdir(REQUESTS)
        if name.endswith(".json")
        and not os.path.exists(os.path.join(RESPONSES, name))
    )


def OnInit():
    _mkdir(REQUESTS)
    _mkdir(RESPONSES)
    _write_json(SESSION_PATH, _session())
    print("INDRO_FL_BRIDGE_READY", SESSION_ID, device.isAssigned())


def OnIdle():
    global LAST_HEARTBEAT
    now = time.time()
    if now - LAST_HEARTBEAT >= 1.0:
        _write_json(SESSION_PATH, _session())
        LAST_HEARTBEAT = now
    try:
        pending = _pending_requests()
        if pending:
            _process(os.path.join(REQUESTS, pending[0]))
    except Exception as error:
        print("INDRO_FL_BRIDGE_IDLE_ERROR", repr(error))


def OnMidiMsg(event):
    # One fixed trigger on channel 16. Command content stays in the
    # session-targeted mailbox; arbitrary MIDI cannot select an operation.
    if event.status == 0xBF and event.data1 == 118 and event.data2 == 127:
        event.handled = True
        pending = _pending_requests()
        if pending:
            _process(os.path.join(REQUESTS, pending[0]))
        _write_json(SESSION_PATH, _session())


def OnDeInit():
    print("INDRO_FL_BRIDGE_STOPPED", SESSION_ID)
