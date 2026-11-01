import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, `benchmark-runs-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.ndjson`);
const cli = resolve(here, '..', '..', 'packages', 'indro', 'cli.mjs');
const capability = 'fl.plugin.parameter.grain-spacing';

function command(args) {
  const started = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const durationMs = performance.now() - started;
  let json = null;
  try { json = JSON.parse(result.stdout); } catch {}
  return { args, durationMs, status: result.status, json, stderr: result.stderr?.trim() || null };
}

function verified(result) {
  return result.status === 0 && result.json?.transaction?.verdict === 'STATE_CONFIRMED';
}

function invoked(result) {
  return result.status === 0 && result.json?.code === 0 && result.json?.result?.transaction?.verdict === 'STATE_CONFIRMED';
}

function conditionA(value) {
  const calls = [];
  calls.push(command(['fl', 'doctor', '--json']));
  calls.push(command(['fl', 'plugins', 'list', '--json']));
  const plugin = calls.at(-1).json?.plugins?.find(item => item.plugin_name?.toLowerCase() === 'fruity granulizer');
  if (!plugin) throw new Error('DISCOVERY_PLUGIN_NOT_FOUND');
  calls.push(command(['fl', 'plugin', 'params', '--channel', String(plugin.channel), '--json']));
  const parameter = calls.at(-1).json?.parameters?.find(item => item.name === 'Grain spacing');
  if (!parameter) throw new Error('DISCOVERY_PARAMETER_NOT_FOUND');
  calls.push(command(['fl', 'plugin', 'get', '--channel', String(plugin.channel), '--param', String(parameter.index), '--json']));
  const pre = calls.at(-1).json?.value;
  calls.push(command(['fl', 'plugin', 'set', '--channel', String(plugin.channel), '--param', String(parameter.index), '--value', String(value), '--verify', '--json']));
  calls.push(command(['fl', 'plugin', 'set', '--channel', String(plugin.channel), '--param', String(parameter.index), '--value', String(pre), '--verify', '--json']));
  return { calls, success: verified(calls.at(-2)) && verified(calls.at(-1)), set: calls.at(-2).json, restore: calls.at(-1).json, probes: 15, discoveryOperations: 4 };
}

function retained(value, optimized) {
  const flag = optimized ? ['--validation-snapshot'] : [];
  const calls = [command(['capability', 'invoke', capability, '--value', String(value), '--verify', '--authorize-write', ...flag, '--json'])];
  const pre = calls[0].json?.result?.transaction?.pre_observation?.value;
  // The first transaction observes the live pre-state before mutation; never restore a fixture constant.
  if (Number.isFinite(pre)) {
    calls.push(command(['capability', 'invoke', capability, '--value', String(pre), '--verify', '--authorize-write', ...flag, '--json']));
  }
  const restored = calls[1]?.json?.result?.transaction?.post_observation?.value;
  const restoredToPre = Number.isFinite(pre) && Number.isFinite(restored) && Math.abs(restored - pre) <= 0.001;
  return { calls, success: calls.length === 2 && calls.every(invoked) && restoredToPre,
    error: Number.isFinite(pre) ? null : 'PRE_STATE_NOT_OBSERVED', preValue: pre, restoredToPre,
    set: calls[0].json?.result, restore: calls[1]?.json?.result,
    probes: optimized ? 12 : 14, discoveryOperations: 0 };
}

const runners = { A: conditionA, B: value => retained(value, false), C: value => retained(value, true) };
const orders = [['A', 'B', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B']];
process.stdout.write(`EVIDENCE=${output}\n`);
for (let trial = 0; trial < 10; trial++) {
  const value = Number((0.21 + trial * 0.031).toFixed(3));
  for (const condition of orders[trial % orders.length]) {
    const started = performance.now();
    let outcome;
    try { outcome = runners[condition](value); }
    catch (error) { outcome = { calls: [], success: false, error: error.message, probes: 0, discoveryOperations: 0 }; }
    const record = {
      schema: 'indro.fl-capability-benchmark/v1', trial: trial + 1, order: orders[trial % orders.length], condition, target: value,
      wallMs: performance.now() - started, success: outcome.success, error: outcome.error ?? null,
      preValue: Number.isFinite(outcome.preValue) ? outcome.preValue : null, restoredToPre: outcome.restoredToPre ?? null,
      cliCommands: outcome.calls.length, toolCalls: outcome.calls.length, hostProbes: outcome.probes, discoveryOperations: outcome.discoveryOperations,
      failures: outcome.calls.filter(call => call.status !== 0).length,
      set: outcome.set ? { readback: outcome.set.transaction?.post_observation?.value, receipt: outcome.set.evidence?.path, sha256: outcome.set.evidence?.sha256 } : null,
      restore: outcome.restore ? { readback: outcome.restore.transaction?.post_observation?.value, receipt: outcome.restore.evidence?.path, sha256: outcome.restore.evidence?.sha256 } : null,
      commands: outcome.calls.map(call => ({ args: call.args, durationMs: call.durationMs, status: call.status, stderr: call.stderr })),
      modelTokens: null,
    };
    appendFileSync(output, `${JSON.stringify(record)}\n`);
    process.stdout.write(`${condition}${trial + 1} ${record.success ? 'PASS' : 'FAIL'} ${record.wallMs.toFixed(1)}ms\n`);
    if (!record.success) process.exitCode = 1;
  }
}
