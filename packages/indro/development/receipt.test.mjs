import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateDevelopmentReceipt } from './receipt.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(root) {
  const bytes = Buffer.from('verified evidence\n'), evidence = join(root, 'evidence.log'); writeFileSync(evidence, bytes);
  const receipt = { schema:'indro.development-transaction/v1', objective:'Improve observable behavior', verdict:'PASS', authority:{ source_revision:'a'.repeat(40), runtime_sha256:'b'.repeat(64) }, budgets:{ declared:{ actions:8, seconds:30 }, consumed:{ actions:7, seconds:2.5 } }, observations:{ baseline:{ souls:0 }, final:{ souls:1 } }, actions:[{ kind:'step' }], checks:[{ id:'behavior', role:'positive', verdict:'PASS' },{ id:'budget-rejection', role:'negative', verdict:'PASS' }], evidence:[{ path:'evidence.log', bytes:bytes.length, sha256:hash(bytes) }], limitations:[] };
  const path = join(root, 'receipt.json'); writeFileSync(path, JSON.stringify(receipt)); return { path, receipt, evidence };
}
test('development receipt validates exact identity, budgets, controls, and evidence', () => { const root=mkdtempSync(join(tmpdir(),'indro-development-')); try { const result=validateDevelopmentReceipt(fixture(root).path); assert.equal(result.valid,true); assert.equal(result.reusable,true); assert.equal(result.evidence.length,1); } finally { rmSync(root,{recursive:true,force:true}); } });
test('development receipt rejects exceeded budgets and tampered evidence', () => { const root=mkdtempSync(join(tmpdir(),'indro-development-')); try { const f=fixture(root); f.receipt.budgets.consumed.actions=9; writeFileSync(f.path,JSON.stringify(f.receipt)); writeFileSync(f.evidence,'tampered'); const result=validateDevelopmentReceipt(f.path); assert.equal(result.valid,false); assert(result.issues.includes('budget_exceeded:actions')); assert(result.issues.includes('evidence_mismatch:evidence.log')); } finally { rmSync(root,{recursive:true,force:true}); } });
test('development receipt rejects path escape and unsupported passing checks', () => { const root=mkdtempSync(join(tmpdir(),'indro-development-')); try { const f=fixture(root); f.receipt.evidence[0].path='../escape.log'; f.receipt.checks[1].verdict='FAIL'; writeFileSync(f.path,JSON.stringify(f.receipt)); const result=validateDevelopmentReceipt(f.path); assert.equal(result.valid,false); assert(result.issues.includes('passing_checks')); } finally { rmSync(root,{recursive:true,force:true}); } });
