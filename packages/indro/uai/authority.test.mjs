import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAuthority } from './authority.mjs';

const tx = { verdict: 'STATE_CONFIRMED', post_observation: { value: 0.75 } };
const observation = (source, value) => ({ source, state: { value } });
const graph = (primary, secondary, shared = false) => ({
  primary,
  sources: {
    [primary]: { depends_on: shared ? ['cache'] : [] },
    [secondary]: { depends_on: shared ? ['cache'] : [] },
    ...(shared ? { cache: { depends_on: [] } } : {})
  }
});

test('declared separate paths are provisional only', () => {
  assert.equal(evaluateAuthority({
    transaction: tx, observation: observation('reader', 0.75),
    graph: graph('adapter', 'reader')
  }).verdict, 'PROVISIONALLY_CORROBORATED');
});

test('contradictory observations are detected', () => {
  assert.equal(evaluateAuthority({
    transaction: tx, observation: observation('reader', 0.2),
    graph: graph('adapter', 'reader')
  }).verdict, 'CONTRADICTED');
});

test('shared dependency prevents corroboration', () => {
  assert.equal(evaluateAuthority({
    transaction: tx, observation: observation('reader', 0.75),
    graph: graph('adapter', 'reader', true)
  }).verdict, 'UNKNOWN');
});

test('missing dependency prevents corroboration', () => {
  const g = graph('adapter', 'reader');
  g.sources.reader.depends_on = ['missing'];
  assert.equal(evaluateAuthority({
    transaction: tx, observation: observation('reader', 0.75), graph: g
  }).verdict, 'UNKNOWN');
});

test('same source cannot corroborate itself', () => {
  assert.equal(evaluateAuthority({
    transaction: tx, observation: observation('adapter', 0.75),
    graph: graph('adapter', 'reader')
  }).verdict, 'UNKNOWN');
});
