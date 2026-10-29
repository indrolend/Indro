import { inspectRemoteHost, remoteRecoveryPlan } from './host.mjs';

const HELP = `INDRO remote desktop control boundary (read-only)
  indro remote status --json
  indro remote doctor --json
  indro remote recovery-plan --json

Mutating recovery is intentionally unavailable until end-to-end client verification is attached.`;

export async function runRemoteCli(args, dependencies = {}) {
  const inspect = dependencies.inspect || inspectRemoteHost;
  const out = dependencies.out || (value => console.log(JSON.stringify(value, null, 2)));
  const error = dependencies.error || (value => console.error(value));
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') { console.log(HELP); return 0; }
  if (rest.some(value => value !== '--json')) { error('INDRO_ERROR remote accepts only --json.'); return 2; }
  if (!['status', 'doctor', 'recovery-plan'].includes(command)) {
    error('INDRO_ERROR remote control is read-only; use status, doctor, or recovery-plan.'); return 2;
  }
  const status = inspect();
  if (command === 'recovery-plan') out(remoteRecoveryPlan(status)); else out(status);
  return command === 'doctor' && status.verdict === 'HOST_NOT_READY' ? 1 : 0;
}
