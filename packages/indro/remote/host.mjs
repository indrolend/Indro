import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const sunshineRoot = process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Sunshine` : 'C:\\Program Files\\Sunshine';

function identity(path) {
  if (!existsSync(path)) return { path, exists: false };
  const bytes = readFileSync(path);
  return { path, exists: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function execute(file, args = []) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  return { ok: !result.error && result.status === 0, status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error?.code || null };
}

export function parseDxgi(text = '') {
  const output = text.match(/Output Name\s*:\s*(.+)/i)?.[1]?.trim() || null;
  const resolution = text.match(/Resolution\s*:\s*(\d+)x(\d+)/i);
  return { detected: Boolean(output && resolution), output, width: resolution ? Number(resolution[1]) : null, height: resolution ? Number(resolution[2]) : null };
}

export function parseSunshineLog(text = '') {
  const lines = text.split(/\r?\n/);
  const last = pattern => [...lines].reverse().find(line => pattern.test(line)) || null;
  const connected = last(/CLIENT CONNECTED/i);
  const disconnected = last(/CLIENT DISCONNECTED/i);
  const encoder = last(/created encoder/i);
  const capture = last(/Capture size\s*:/i);
  const pathErrors = lines.filter(line => /Failed to collect path source data/i.test(line)).length;
  return {
    encoderObserved: Boolean(encoder), captureObserved: Boolean(capture),
    lastEncoder: encoder, lastCapture: capture,
    activeStreamInLog: Boolean(connected && (!disconnected || lines.lastIndexOf(connected) > lines.lastIndexOf(disconnected))),
    lastConnected: connected, lastDisconnected: disconnected, pathSourceErrors: pathErrors,
  };
}

function windowsFacts() {
  if (process.platform !== 'win32') return { supported: false };
  const script = [
    "$fl=Get-Process FL64 -ErrorAction SilentlyContinue|Select-Object -First 1 Id,SessionId,Responding,StartTime,Path",
    "$sun=Get-Process sunshine -ErrorAction SilentlyContinue|Select-Object -First 1 Id,SessionId,Responding,StartTime,Path",
    "$svc=Get-CimInstance Win32_Service -Filter \"Name='SunshineService'\"|Select-Object Name,State,StartMode,StartName,ProcessId,PathName",
    "$gpu=Get-CimInstance Win32_VideoController|Where-Object Name -match 'NVIDIA'|Select-Object -First 1 Name,Status,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate",
    "$monitor=Get-PnpDevice -Class Monitor|Select-Object FriendlyName,Status,Problem,InstanceId",
    "[pscustomobject]@{fl=$fl;sunshine=$sun;service=$svc;gpu=$gpu;monitors=@($monitor)}|ConvertTo-Json -Depth 5 -Compress",
  ].join(';');
  const result = execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (!result.ok) return { supported: true, error: result.error || result.stderr.trim() || `exit ${result.status}` };
  try { return { supported: true, ...JSON.parse(result.stdout) }; }
  catch { return { supported: true, error: 'WINDOWS_FACTS_INVALID_JSON' }; }
}

function tailscaleFacts() {
  const result = execute('tailscale.exe', ['status', '--json']);
  if (!result.ok) return { available: false, error: result.error || result.stderr.trim() || `exit ${result.status}` };
  try {
    const value = JSON.parse(result.stdout);
    return { available: true, state: value.BackendState, dnsName: value.Self?.DNSName || null, addresses: value.Self?.TailscaleIPs || [] };
  } catch { return { available: true, error: 'TAILSCALE_STATUS_INVALID_JSON' }; }
}

export function buildRemoteStatus({ windows, dxgi, log, tailscale, executable, config }) {
  const coreReady = windows.supported && !windows.error && windows.service?.State === 'Running'
    && windows.sunshine?.Responding === true && dxgi.detected;
  return {
    schema: 'indro.remote-desktop-status/v1',
    verdict: coreReady ? 'HOST_READY_END_TO_END_UNVERIFIED' : 'HOST_NOT_READY',
    authority: {
      desktop: 'windows-console-session', transport: 'sunshine', privateNetwork: 'tailscale',
      orchestration: 'indro', terminalRecovery: 'ssh',
    },
    host: windows,
    sunshine: { executable, config, log, serviceReady: windows.service?.State === 'Running', processReady: windows.sunshine?.Responding === true },
    display: dxgi,
    network: tailscale,
    claims: {
      hostReachable: true,
      remoteServerRunning: windows.service?.State === 'Running' && windows.sunshine?.Responding === true,
      displayDetected: dxgi.detected,
      captureInitialized: log.captureObserved,
      encoderInitialized: log.encoderObserved,
      streamConnected: log.activeStreamInLog,
      validDesktopPixelsObservedByClient: null,
      remoteInputConfirmed: null,
      endToEndControlVerified: false,
    },
    limitations: [
      'Host diagnostics cannot prove that Moonlight received non-black pixels.',
      'Host diagnostics cannot prove remote keyboard or pointer effects.',
      'Sunshine path-source errors are observed but not assigned as the black-screen cause.',
    ],
  };
}

export function inspectRemoteHost() {
  const executablePath = `${sunshineRoot}\\Sunshine.exe`;
  const configPath = `${sunshineRoot}\\config\\sunshine.conf`;
  const logPath = `${sunshineRoot}\\config\\sunshine.log`;
  const dxgiPath = `${sunshineRoot}\\tools\\dxgi-info.exe`;
  const dxgiRun = execute(dxgiPath);
  const logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
  return buildRemoteStatus({
    windows: windowsFacts(), dxgi: parseDxgi(dxgiRun.stdout + dxgiRun.stderr), log: parseSunshineLog(logText),
    tailscale: tailscaleFacts(), executable: identity(executablePath), config: identity(configPath),
  });
}

export function remoteRecoveryPlan(status) {
  return {
    schema: 'indro.remote-desktop-recovery-plan/v1', mutationPerformed: false,
    eligibleForSunshineOnlyRestart: Boolean(status.host?.fl?.Responding && status.sunshine?.serviceReady),
    guards: ['No active Sunshine stream', 'FL Studio responsive in the console session', 'SunshineService identity unchanged', 'SSH recovery remains reachable'],
    steps: ['Capture pre-state', 'Restart SunshineService only', 'Wait for session-1 Sunshine process', 'Verify DXGI display and encoder', 'Require client pixel and input confirmation'],
    forbidden: ['Windows reboot', 'user logoff', 'display-driver reset', 'FL Studio termination', 'blind restart after uncertain outcome'],
  };
}
