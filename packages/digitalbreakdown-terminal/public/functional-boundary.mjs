// Functional actions are authoritative. Observation and visual work may fail,
// be disabled, or be absent without changing the completed functional action.
export function runFunctionalThenObserve(functional, observe = () => {}) {
  const result = functional();
  try {
    observe();
  } catch {
    // Observation is explicitly non-authoritative.
  }
  return result;
}

export function safeVisualCall(visual, method, ...argumentsList) {
  try {
    return visual?.[method]?.(...argumentsList);
  } catch {
    return undefined;
  }
}
