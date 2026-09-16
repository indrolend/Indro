import { searchRepository } from './core.mjs';

const capabilityRegistry = new Map([
  [
    'search',
    {
      id: 'search',
      label: 'Search repository',

      async available(session) {
        return {
          available: true,
          engine: 'rg',
          project: session.project,
        };
      },

      async execute(session, request = {}) {
        const record = await searchRepository(
          session.project,
          request.query,
          request.scope ?? '.',
          {
            origin: request.origin ?? 'capability',
            ...(request.tool ? { tool: request.tool } : {}),
          },
        );

        return {
          capability: 'search',
          engine: record.operation.tool ?? 'rg',
          record,
        };
      },
    },
  ],
]);

export function getCapability(id) {
  return capabilityRegistry.get(String(id || '')) ?? null;
}

export function listCapabilities() {
  return [...capabilityRegistry.values()];
}
