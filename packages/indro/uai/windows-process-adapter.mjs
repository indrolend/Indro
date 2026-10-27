import { execFileSync } from 'node:child_process';

function powershell(script) {
  const output = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 15000, windowsHide: true
  }).trim();
  return output ? JSON.parse(output) : null;
}

function validPid(value) {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid PID');
  return pid;
}

const quoted = value => `'${String(value).replaceAll("'", "''")}'`;

export function processSnapshot(pidValue) {
  const pid = validPid(pidValue);
  return powershell(`$ErrorActionPreference='Stop'; $p=Get-Process -Id ${pid} -ErrorAction Stop; $c=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction Stop; [ordered]@{ powershell=[ordered]@{ pid=$p.Id; creation_time=$p.StartTime.ToUniversalTime().ToString('o'); path=$p.Path; priority=$p.PriorityClass.ToString() }; cim=[ordered]@{ pid=[int]$c.ProcessId; creation_time=$c.CreationDate.ToUniversalTime().ToString('o'); path=$c.ExecutablePath; priority=[int]$c.Priority } } | ConvertTo-Json -Compress -Depth 4`);
}

export function processIdentityProbe(pidValue) {
  const pid = validPid(pidValue);
  return powershell(`$p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if($null -eq $p){@{present=$false}|ConvertTo-Json -Compress}else{@{present=$true;creation_time=$p.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress}`);
}

function assertIdentity(target, snapshot) {
  if (!target?.creation_time) throw new Error('Process creation-time identity required');
  if (snapshot?.powershell?.pid !== Number(target.process_id) || snapshot.powershell.creation_time !== target.creation_time) {
    throw new Error('Process identity mismatch (possible PID reuse)');
  }
}


function assertSnapshotAgreement(snapshot) {
  const primary = snapshot?.powershell;
  const cim = snapshot?.cim;
  if (!cim || cim.pid !== primary?.pid) throw new Error('CIM process identity mismatch');
  const a = Date.parse(primary.creation_time);
  const b = Date.parse(cim.creation_time);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 100)
    throw new Error('CIM creation-time mismatch');
  if (typeof primary.path !== 'string' || !primary.path ||
      typeof cim.path !== 'string' || primary.path.toLowerCase() !== cim.path.toLowerCase())
    throw new Error('CIM executable path mismatch');
  const expected = { Idle: 4, BelowNormal: 6, Normal: 8, AboveNormal: 10, High: 13, RealTime: 24 }[primary.priority];
  if (expected === undefined || cim.priority !== expected)
    throw new Error('CIM priority contradicts primary readback');
  return expected;
}

export function createWindowsProcessAdapter({ snapshot = processSnapshot } = {}) {
  return {
    name: 'experimental-windows-process-adapter',
    async observe(target) {
      const observed = snapshot(validPid(target.process_id));
      assertIdentity(target, observed);
      const cimPriority = assertSnapshotAgreement(observed);
      return {
        value: observed.powershell.priority,
        identity: { process_id: observed.powershell.pid, creation_time: observed.powershell.creation_time },
        secondary_observation: { source: 'Win32_Process/CIM', priority: observed.cim.priority, process_id: observed.cim.pid,
          creation_time: observed.cim.creation_time, executable_path: observed.cim.path,
          consistency: observed.cim.pid === observed.powershell.pid && observed.cim.priority === cimPriority ? 'CONSISTENT' : 'CONTRADICTED' },
        provenance: { primary: 'System.Diagnostics.Process via Get-Process', secondary: 'Win32_Process via CIM',
          shared_authority: 'Windows process state', independence_verified: false }
      };
    },
    async invoke(target, capability, args) {
      if (capability.id !== 'process.priority') throw new Error('Unsupported capability');
      if (args.value !== 'BelowNormal') throw new Error('Unsupported priority');
      const before = snapshot(validPid(target.process_id));
      assertIdentity(target, before);
      assertSnapshotAgreement(before);
      powershell(`$ErrorActionPreference='Stop'; $p=Get-Process -Id ${validPid(target.process_id)} -ErrorAction Stop; if($p.StartTime.ToUniversalTime().ToString('o') -ne ${quoted(target.creation_time)}){throw 'Process identity mismatch (possible PID reuse)'}; $p.PriorityClass=${quoted(args.value)}; @{ok=$true}|ConvertTo-Json -Compress`);
      return { milestones: { EXECUTED: true } };
    }
  };
}

export const windowsProcessAdapter = createWindowsProcessAdapter();
