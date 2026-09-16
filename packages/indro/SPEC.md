# Indro v0.7 language specification

## Optimization target

Indro minimizes `explicit semantic tokens / correctly evidenced work`. It
does not minimize spelling at the cost of hidden authority or missing causal
information. Full and compact syntax are two surfaces over one typed IR.

| Full | Compact | Meaning |
|---|---|---|
| `program repair` | `@repair` | program identity |
| `intent "..."` | `!"..."` | semantic objective |
| `param x:path` | `$x:path` | typed input |
| `permit read write exec` | `+rwx` | effect ceiling |
| `flow main:` | `:main` | named flow |
| `do orient` | `>o` | semantic action |
| `parallel:` | `||` | concurrent lanes |
| `recover:` | `~` | failure path |
| `ensure "..."` | `?"..."` | postcondition |
| `emit "..."` | `."..."` | evidence event |

Compact word aliases are deliberately few, contextual, and canonicalized
before compilation. Two spellings with identical meaning receive the same
plan ID.

## Compiler model

A Indro program declares an intent, typed inputs, permitted effects, and one
or more flows. The compiler resolves semantic words into primitives, infers
effects, validates source authority, validates invocation authority, binds and
type-checks parameters, and emits a canonical plan with a stable content ID.

```indro
program repair
intent "repair ${target} and prove the result"
param target: path
permit read write exec

flow main:
  do orient
  parallel:
    do audit ${target}
    do doctor
  do prove ${target}
  ensure "tests pass for ${target}"
  recover:
    do checkpoint
```

`parallel:` expresses independent plan lanes. `recover:` is an explicit
failure path. `ensure` records a postcondition and `emit` records an evidence
event. Workspace adapters must preserve these semantics when executing the
compiled plan.

Indro is an evidence-native semantic language for software work. A word denotes an outcome-oriented operation over a workspace, its runtime, and retained evidence.

## Laws

1. **Stable process -> one word.**
2. **Inferable workspace context is implicit.**
3. **Consequential authority changes remain explicit.**
4. **Evidence is ambient.** CommandHUD owns rich terminal evidence; Indro records intent, plan, and linkage.
5. **Plans are inspectable.** `indro plan WORD` resolves nested words before execution.
6. **Composite safety is transitive.** Consequential primitives cannot be hidden inside nested composites.
7. **Vocabulary must earn abstraction.** Cross-project/repeated evidence is preferred over one-off aliases.
8. **Semantic phases outrank shell syntax.** Historical benchmarks show phase motifs generalize better than exact command-family motifs.
9. **Intent is first-class.** Indro names the work; CommandHUD records the execution evidence.
10. **The language dogfoods itself.** `learn` mines, suggests, benchmarks, cross-checks, and self-tests.

## Core language vs workspace dialects

Vocabulary mining distinguishes **core motifs** (repeated across at least two project namespaces) from **dialect motifs** (repeated strongly inside one project). Core evidence can justify universal Indro words; dialect evidence should normally become workspace-specific vocabulary instead of polluting the global language. `suggest` reports both classes but never mutates language authority automatically.

## Semantic phase model

The current history miner maps concrete terminal actions into deliberately lossy phases:

```text
orient    establish authority/location/state
inspect   search/read/history/source inspection
compare   differences/evidence comparison
modify    source mutation
build     compilation/artifact construction
test      focused or broad executable checks
runtime   smoke/runtime execution
sync      remote-state retrieval
vcs       other version-control actions
tool      generic node/npm/python tooling
```

Repeated adjacent phases collapse in the historical representation. This is an analysis model, not permission to omit real operations during execution.

## Evidence

Preferred root: `D:\hud`.

CommandHUD retains stdout/stderr, repository authority, exit state, reductions, and provenance. Indro adds a small run envelope containing the invoked word, arguments, flattened plan, workspace, source HEAD/status before and after, and nearest CommandHUD evidence paths.

## Core meta-program

```text
learn := dogfood -> suggest -> measure -> selftest
measure := bench -> languagebench -> crosscheck
orient := status -> audit
resume := orient
```

## Safety boundary

Composite words cannot contain or transitively resolve to `commit`, `push`, `merge`, `rebase`, `reset`, `clean`, `release`, `publish`, or `ship`. Those require an explicit top-level action.
