#!/usr/bin/env node
import { resolveProject, runAgentRequest } from './core.mjs';

let announced = false;
try {
  const request = JSON.parse(Buffer.from(process.argv[2] || '', 'base64url').toString('utf8'));
  const project = await resolveProject({ root: request.root, env: { ...process.env, HUD_STATE_ROOT: request.store } });
  await runAgentRequest(project, request.prompt, {
    agent: request.agent, expectedHead: request.expectedHead, isolate: true, stream: false,
    codexLauncher: request.codexLauncher,
    origin: 'core-api',
    onStart: (value) => {
      announced = true;
      process.stdout.write(`${JSON.stringify(value)}\n`);
    },
  });
} catch (error) {
  if (!announced) process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
