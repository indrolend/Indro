export const OPERATION_MODES = Object.freeze(['finite', 'probe', 'interactive', 'watch', 'detached', 'training']);

export function operationPolicy({ mode = 'finite', timeoutMs = null, requiredOutput = 'none' } = {}) {
  if (!OPERATION_MODES.includes(mode)) throw new Error(`Unsupported operation mode: ${mode}`);
  if (timeoutMs !== null && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)) {
    throw new Error('Operation timeout must be a positive integer in milliseconds.');
  }
  if (mode === 'probe' && timeoutMs === null) throw new Error('Probe operations require a timeout.');
  if (!['none', 'any', 'stdout', 'stderr'].includes(requiredOutput)) {
    throw new Error(`Unsupported evidence output requirement: ${requiredOutput}`);
  }
  return Object.freeze({ mode, timeoutMs, requiredOutput });
}

function meaningful(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim().length > 0;
}

export function validateOperationEvidence({ stdout = '', stderr = '' }, requiredOutput = 'none') {
  const stdoutValid = meaningful(stdout);
  const stderrValid = meaningful(stderr);
  const valid = requiredOutput === 'none' ? true
    : requiredOutput === 'stdout' ? stdoutValid
      : requiredOutput === 'stderr' ? stderrValid
        : stdoutValid || stderrValid;
  return {
    valid,
    requirement: requiredOutput,
    stdoutContentValid: stdoutValid,
    stderrContentValid: stderrValid,
    reason: valid ? null : `Required ${requiredOutput} evidence was empty or BOM-only.`,
  };
}
