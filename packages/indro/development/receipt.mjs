import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const DEVELOPMENT_RECEIPT_SCHEMA = 'indro.development-transaction/v1';
const hex = (value, length) => typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const safeNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function validateDevelopmentReceipt(path) {
  const receiptPath = resolve(path), issues = [];
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); }
  catch (error) { return { valid: false, reusable: false, issues: [`receipt_unreadable:${error.code ?? error.message}`], receipt: null, evidence: [] }; }
  if (receipt?.schema !== DEVELOPMENT_RECEIPT_SCHEMA) issues.push('schema');
  if (typeof receipt?.objective !== 'string' || !receipt.objective.trim()) issues.push('objective');
  if (!['PASS', 'FAIL'].includes(receipt?.verdict)) issues.push('verdict');
  if (!hex(receipt?.authority?.source_revision, 40)) issues.push('source_revision');
  if (!hex(receipt?.authority?.runtime_sha256, 64)) issues.push('runtime_sha256');
  if (typeof receipt?.authority?.adapter !== 'string' || !receipt.authority.adapter.trim()) issues.push('adapter');
  if (!receipt?.observations || !Object.hasOwn(receipt.observations, 'baseline') || !Object.hasOwn(receipt.observations, 'final')) issues.push('observations');
  if (!Array.isArray(receipt?.actions)) issues.push('actions');
  const declared = receipt?.budgets?.declared, consumed = receipt?.budgets?.consumed;
  if (!declared || !consumed || typeof declared !== 'object' || typeof consumed !== 'object') issues.push('budgets');
  else {
    for (const [name, limit] of Object.entries(declared)) if (!safeNumber(limit)) issues.push(`budget_invalid:${name}`);
    for (const [name, used] of Object.entries(consumed)) {
      if (!Object.hasOwn(declared, name) || !safeNumber(used) || !safeNumber(declared[name])) issues.push(`budget_invalid:${name}`);
      else if (used > declared[name]) issues.push(`budget_exceeded:${name}`);
    }
    if (safeNumber(consumed.actions) && Array.isArray(receipt?.actions) && consumed.actions !== receipt.actions.length) issues.push('action_count_mismatch');
    if (safeNumber(consumed.simulation_ticks) && safeNumber(receipt?.observations?.final?.tick) && consumed.simulation_ticks !== receipt.observations.final.tick) issues.push('tick_budget_mismatch');
  }
  if (Array.isArray(receipt?.actions)) for (let index = 0; index < receipt.actions.length; ++index) {
    const action = receipt.actions[index];
    if (!action || typeof action !== 'object') { issues.push('action_invalid'); continue; }
    if (Object.hasOwn(action, 'index') && action.index !== index) issues.push('action_index_sequence');
    if (safeNumber(action.tick_before) && safeNumber(action.tick_after) && action.tick_after < action.tick_before) issues.push('action_tick_sequence');
    if (index > 0 && safeNumber(action.tick_before) && safeNumber(receipt.actions[index - 1]?.tick_after) && action.tick_before !== receipt.actions[index - 1].tick_after) issues.push('action_tick_continuity');
  }
  const checks = Array.isArray(receipt?.checks) ? receipt.checks : [];
  if (!checks.length) issues.push('checks');
  for (const check of checks) if (typeof check?.id !== 'string' || !['positive', 'negative', 'regression'].includes(check?.role) || !['PASS', 'FAIL'].includes(check?.verdict)) issues.push('check_invalid');
  if (receipt?.verdict === 'PASS' && (!checks.some(check => check.role === 'positive' && check.verdict === 'PASS') || checks.some(check => check.verdict !== 'PASS'))) issues.push('passing_checks');
  if (!Array.isArray(receipt?.limitations) || receipt.limitations.some(value => typeof value !== 'string' || !value.trim())) issues.push('limitations');
  const root = dirname(receiptPath), evidence = [], evidencePaths = new Set();
  if (!Array.isArray(receipt?.evidence) || !receipt.evidence.length) issues.push('evidence');
  else for (const item of receipt.evidence) {
    if (typeof item?.path !== 'string' || isAbsolute(item.path) || !hex(item?.sha256, 64) || !safeNumber(item?.bytes)) { issues.push('evidence_entry'); continue; }
    const normalizedPath = item.path.replaceAll('\\', '/');
    if (evidencePaths.has(normalizedPath)) { issues.push(`evidence_duplicate:${item.path}`); continue; }
    evidencePaths.add(normalizedPath);
    const target = resolve(root, item.path), relativePath = relative(root, target), escaped = relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativePath);
    if (escaped || !existsSync(target) || !statSync(target).isFile()) { issues.push(`evidence_missing:${item.path}`); continue; }
    const bytes = readFileSync(target), actual = sha256(bytes);
    if (bytes.length !== item.bytes || actual !== item.sha256.toLowerCase()) issues.push(`evidence_mismatch:${item.path}`);
    evidence.push({ path: target, bytes: bytes.length, sha256: actual });
  }
  const valid = issues.length === 0;
  return { valid, reusable: valid && receipt.verdict === 'PASS', issues: [...new Set(issues)], receipt, evidence, receipt_sha256: sha256(readFileSync(receiptPath)) };
}
