# CommandHUD harness specification

## Product contract

CommandHUD is the user-owned authority for local coding-agent work. ChatGPT, Codex, Ollama, and future model providers are replaceable workers or clients. Git identity, isolated workspaces, lifecycle state, and retained evidence remain under CommandHUD control.

The default route minimizes resistance without silently spending paid capacity:

1. Prefer `codex/ollama` for local, free work.
2. Keep the objective, repository checkout, operation journal, and final evidence locally owned.
3. Offer `codex/local` only as a visible, explicit external-provider escalation.
4. Never retry or fall back from local to paid automatically.
5. Record the selected provider, cost class, data boundary, and whether external transmission occurred.

This policy optimizes cost and ownership; it does not claim that one model wins every coding task. Quality is established from retained project evidence and verification, not provider branding.

## Remote surface

The ChatGPT MCP adapter exposes exactly eight tools:

- `open_commandhud` — read-only control-panel projection
- `list_projects` — read-only verified project discovery
- `list_agents` — read-only harness discovery for an exact project ID
- `start_agent` — deliberate isolated start at an exact expected Git HEAD
- `list_agent_sessions` — read-only retained-session discovery
- `get_agent` — read-only inspection by exact session ID
- `stop_agent` — deliberate bounded cancellation by exact session ID
- `discard_agent_workspace` — deliberate workspace removal while evidence remains

No tool accepts arbitrary shell text, executable names, process IDs, working directories, repository roots, or filesystem paths. Project roots and agent process identities are resolved locally from verified retained authority and omitted from remote results.

## Embedded control panel

`open_commandhud` renders a replaceable MCP Apps widget with this choice tree:

```text
verified project
  -> common recipe or retained sessions
     -> available harness
        -> objective
           -> exact project / HEAD / harness / data-boundary review
              -> deliberate start
```

Common recipes are explore, diagnose, review, implement, tests, verify, and hard-problem escalation. Local execution is recommended for every ordinary recipe. Paid escalation is labeled explicitly. Stop and discard require confirmation in the widget; server-side typed identity checks remain authoritative.

## Session and data ownership

- Each start creates an isolated Git worktree at the caller-supplied, currently verified HEAD.
- The source checkout is not the worker workspace.
- CommandHUD's immutable run ID is the session identity.
- Provider thread or session IDs are non-authoritative metadata.
- Status, changes, messages, and evidence derive from CommandHUD journals and final records.
- Discard removes only an evidence-owned terminal workspace and retains the evidence record.
- ChatGPT receives bounded semantic results, never local roots or evidence paths.

## Acceptance gates

The harness is ready for a live tunnel revision only when all of the following pass:

1. The complete repository test suite passes.
2. MCP discovery returns exactly the eight named tools and the one `ui://commandhud/control-panel-v1.html` resource.
3. All exposed input properties are typed identities or bounded semantic values; no general execution or path property exists.
4. The widget JavaScript parses and declares local-first, no-automatic-paid-fallback behavior.
5. A real-registry read-only dogfood can list projects, list harnesses for one exact project ID, list sessions, and inspect one existing session only when present.
6. No dogfood acceptance run starts, stops, or discards a session without separate explicit authorization.
7. The private tunnel process is healthy before and after rollout.

## Deliberate non-goals

- General shell or filesystem access through ChatGPT
- Automatic paid-model escalation
- Provider-owned project/session authority
- A second mutable agent database
- Claims that local models are universally better without comparative retained evidence
- Cloud dependence for local execution, evidence retention, or ordinary session control
