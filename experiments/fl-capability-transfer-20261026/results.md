# FL capability transfer — 2026-10-26

Repository `C:\Users\indro\Projects\Indro-fl-cli`, branch `feat/fl-studio-cli`, base `a38ed7b40352e77ec257548c5820bf0d76ce15c8`. FL Studio PID 13808, bridge schema `indro.fl.bridge.v1`, bridge version 1. The project was not saved.

## Retained capability

`fl.plugin.parameter.grain-spacing` was compiled from receipt SHA-256 `5bd9078359762dd2b0b1a9015daa5e31bba987cf15982d325cdb96e46296a2b3` into:

`D:\hud\continuum\capabilities\fl.plugin.parameter.grain-spacing\2026-10-26T19-50-48-521Z-ca29274c-982e-46d2-9766-1ec63e074f28.json`

Capability file SHA-256: `216914194ad50b40dd6873851ca317f977f826dbae6a018b8f86cacafebdc8b4`.

Retention took 76.26 ms, listing 69.59 ms, and live validation 1724.79 ms. A direct retained-capability invocation to 0.35 took 3886.33 ms and read back 0.3497142857142857. Restoration took 4577.89 ms and read back the exact original 0.5554285714285714.

## Fresh-agent comparison

The agents ran sequentially against the same live application. Neither received the parent's conversation history. Both restored the exact pre-value.

| Condition | Target | Wall clock | Tool calls | Canonical CLI commands | Discovery operations | Failures | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Retained capability | 0.42 | 38.661 s | 8 | 5 | 0 manual mapping discovery | 1 reporting-only timestamp calculation | readback 0.41942857142857143; restored |
| No retention | 0.46 | 47.72 s | 15 | 9 | 5 | 2 obsolete global-entrypoint attempts | readback 0.4605714285714286; restored |

Observed single-trial difference: 9.059 seconds (18.98%) less wall time and 7 fewer tool calls (46.67%) with retention. Values and command order differed, so this is an initial falsifiable observation, not a statistically controlled performance claim. The no-retention failures expose an additional deployment confounder: the globally installed `indro` shim did not contain the branch-local FL route.

Reuse receipts:

- Set: `D:\hud\uai\fl-studio\2026-10-26T19-51-50-222Z-3aa420e5-52ca-4e32-9da7-2b8753ffd719\receipt.json`, SHA-256 `a6c5a29a8eba95f5accad44394a44b8c71f97b5fc69b2fab6784b7c79003d10c`.
- Restore: `D:\hud\uai\fl-studio\2026-10-26T19-51-57-500Z-671e9bd6-c477-4dea-81ce-b58d03b729b6\receipt.json`, SHA-256 `38b962b42dc50c9b5c289f27eddf298484340e74f210489bca30c6baa66d0b9b`.

Control receipts:

- Set: `D:\hud\uai\fl-studio\2026-10-26T19-53-10-690Z-97fc6cf0-94a6-4c49-ab96-014371bf06df\receipt.json`, SHA-256 `32b080422f1a97620fbe05d208b20e5da00fe2d9c7ef8a080ba45c71a8cdf1ed`.
- Restore: `D:\hud\uai\fl-studio\2026-10-26T19-53-18-443Z-e1c96a5c-a738-45e6-8291-26dd569cee44\receipt.json`, SHA-256 `7752e846085d034f388cf16a5e989449f4cdca3c55909f1ab0b653e6cbdb7828`.

## Reproduction

```powershell
node packages/indro/cli.mjs capability retain-fl --latest --json
node packages/indro/cli.mjs capability list --json
node packages/indro/cli.mjs capability inspect fl.plugin.parameter.grain-spacing --json
node packages/indro/cli.mjs capability validate fl.plugin.parameter.grain-spacing --json
node packages/indro/cli.mjs capability invoke fl.plugin.parameter.grain-spacing --value 0.42 --verify --authorize-write --json
```

The capability revalidates application, bridge version, adapter/installed-bridge bytes, unique plugin name, and unique parameter name before delegating mutation and readback to the existing FL/UAI path. Its checksum is not authenticated provenance. Host state is verified; audible effect is not.

## Three-arm benchmark

Ten trials per condition ran in counterbalanced `ABC`, `BCA`, `CAB` order. Each trial used the same target across its three conditions and restored the exact original value. All 30 trials passed with no CLI failure or false reuse. Raw records are in `benchmark-runs.ndjson` (SHA-256 `4f9c8ddf4b2d269c7ea985b9e9f2a52026f9808367d36f2ec16211ee18752944`). The excluded initial harness launcher failure is retained separately in `benchmark-launcher-failure.ndjson`.

| Condition | Pass | Median ms | Mean ms | Min ms | Max ms | SD ms | CLI calls | Host probes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A — no retention | 10/10 | 8663.52 | 8687.85 | 8623.44 | 8829.05 | 64.63 | 60 | 150 |
| B — current retention | 10/10 | 7807.03 | 7884.21 | 7726.42 | 8497.52 | 227.99 | 20 | 140 |
| C — scoped snapshot | 10/10 | 6718.30 | 6713.54 | 6682.39 | 6746.19 | 19.25 | 20 | 120 |

Median differences:

- B versus A: 856.49 ms faster (9.89%); 66.67% fewer CLI calls; 6.67% fewer host probes.
- C versus A: 1945.22 ms faster (22.45%); 66.67% fewer CLI calls; 20.00% fewer host probes.
- C versus B: 1088.73 ms faster (13.95%); equal CLI calls; 14.29% fewer host probes.

Mean paired differences were 803.64 ms for A−B, 1170.67 ms for B−C, and 1974.31 ms for A−C. Model-token measurements were unavailable. These trials compare deterministic branch-local CLI procedures, not thirty independently reasoning agents; the earlier two-agent experiment remains the cross-agent evidence. Condition A's explicit discovery sequence and conditions B/C's capability lookup were fixed by the harness, so these results isolate process/probe costs more strongly than agent investigation variance.

The optimized snapshot exists only in memory for one capability invocation. FL CLI rejects it when bridge session/process or channel/application scope differs. The host still checks plugin identity on the write and INDRO still performs pre- and post-readback; the optimization removes only the duplicate pre-invocation `plugin.inspect` call.
