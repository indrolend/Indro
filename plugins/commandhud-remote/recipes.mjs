export const COMMANDHUD_RECIPES = Object.freeze([
  {
    id: 'orient', label: 'Explore repository', risk: 'read-mostly', recommendedAgent: 'codex/ollama',
    description: 'Map the relevant implementation, tests, constraints, and safest next step before editing.',
    objective: 'Inspect this repository for the requested area. Identify the authoritative implementation, relevant tests, current constraints, and the least-resistance path to a verified result. Avoid edits unless a small necessary correction is unambiguous.',
  },
  {
    id: 'diagnose', label: 'Diagnose failure', risk: 'bounded-change', recommendedAgent: 'codex/ollama',
    description: 'Reproduce and explain a failure, then make the smallest verified correction.',
    objective: 'Reproduce the reported failure using the narrowest authoritative check. Determine the evidence-backed root cause, implement the smallest coherent correction, and run focused verification. Preserve unrelated work.',
  },
  {
    id: 'review', label: 'Review changes', risk: 'read-only', recommendedAgent: 'codex/ollama',
    description: 'Review current changes for correctness, regressions, authority violations, and missing tests.',
    objective: 'Review the current repository changes. Prioritize concrete correctness defects, regressions, authority-boundary violations, and missing verification. Do not edit files; return evidence-backed findings ordered by severity.',
  },
  {
    id: 'implement', label: 'Implement bounded change', risk: 'bounded-change', recommendedAgent: 'codex/ollama',
    description: 'Implement one scoped request and verify it without expanding authority.',
    objective: 'Implement the bounded request described below. Inspect existing patterns first, preserve unrelated work and authority boundaries, make the smallest coherent change, and run focused tests before broader verification.',
  },
  {
    id: 'tests', label: 'Add or repair tests', risk: 'bounded-change', recommendedAgent: 'codex/ollama',
    description: 'Strengthen tests around an observed behavior or defect.',
    objective: 'Add or repair the smallest authoritative tests for the behavior described below. Prefer deterministic coverage, reproduce the failure when applicable, avoid implementation-only assertions, and run the focused suite.',
  },
  {
    id: 'verify', label: 'Verify retained work', risk: 'read-mostly', recommendedAgent: 'codex/ollama',
    description: 'Run the narrowest credible verification and report exact evidence.',
    objective: 'Verify the described work using the repository-owned checks. Start with the narrowest relevant tests, expand only when justified, and report commands, exit status, failures, changed paths, and remaining uncertainty. Avoid unrelated edits.',
  },
  {
    id: 'escalate', label: 'Hard problem escalation', risk: 'bounded-change', recommendedAgent: 'codex/local',
    description: 'Use paid capability explicitly for a difficult, evidence-rich problem.',
    objective: 'Solve the difficult bounded problem described below. Use the supplied repository evidence, preserve authority boundaries and unrelated work, explain key tradeoffs, implement the smallest robust solution, and verify it comprehensively.',
  },
]);

export function commandHudRecipes() {
  return COMMANDHUD_RECIPES.map((recipe) => ({ ...recipe }));
}
