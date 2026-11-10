import { isDeepStrictEqual } from 'node:util';

export function evaluateAuthority({ transaction, observation, graph }) {
  const unknown = reason => ({ verdict: 'UNKNOWN', reason });
  const reported = transaction?.post_observation;
  const observed = observation?.state;
  const sources = graph?.sources;
  const primary = graph?.primary;
  const secondary = observation?.source;

  if (!reported || observed === undefined || !sources ||
      !primary || !secondary || !sources[primary] || !sources[secondary])
    return unknown('Incomplete provenance');

  if (primary === secondary)
    return unknown('Same observation source');

  const ancestry = id => {
    const visited = new Set();
    const pending = [id];
    while (pending.length) {
      const current = pending.pop();
      if (visited.has(current)) continue;
      const node = sources[current];
      if (!node || !Array.isArray(node.depends_on))
        return null;
      visited.add(current);
      pending.push(...node.depends_on);
    }
    return visited;
  };

  const a = ancestry(primary);
  const b = ancestry(secondary);
  if (!a || !b) return unknown('Unresolved provenance');
  if ([...a].some(id => b.has(id)))
    return unknown('Shared observation dependency');

  if (!isDeepStrictEqual(reported, observed))
    return { verdict: 'CONTRADICTED', reason: 'Observations disagree', source: secondary };

  if (transaction.verdict !== 'STATE_CONFIRMED')
    return unknown('Transaction confirmation missing');

  return {
    verdict: 'PROVISIONALLY_CORROBORATED',
    reason: 'Declared observation paths are disjoint; external independence not established',
    source: secondary
  };
}
