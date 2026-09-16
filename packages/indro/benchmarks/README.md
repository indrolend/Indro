# Benchmarks

The package contains two distinct benchmark layers.

## Evidence miner

```text
python tools/benchmark-hud.py <hud-root>
```

Checks corpus accounting, sessionization, failure-recovery signal, regression floors, bounded-memory behavior, and semantic motifs.

## Language generalization

```text
python tools/benchmark-language.py <hud-root>
```

Discovers reusable motifs on the earlier 80% of semantic sessions and evaluates on the later 20%. It compares exact command-family motifs with Indro phase motifs and checks motif stability across 5/10/20/30-minute session boundaries.

## Vocabulary suggestions

```text
python tools/suggest-words.py <hud-root>
```

Only proposes motifs with repeated support across at least two project namespaces. Suggestions are evidence for language design; they do not automatically mutate `words.json`.
