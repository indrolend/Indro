# M3 Paint capability-transfer probe

## Environment

- INDRO worktree: `C:\Users\indro\Projects\Indro-paint-m3`
- Branch: `feat/paint-capability-transfer`
- Base commit: `2f472698e8ff6fc4f4576435aa33c5b45941361f`
- Application: Microsoft Paint `11.2605.81.0`
- Control boundary: Windows accessibility/UI automation, explicitly classified as lower assurance

## Observed discovery

The live application exposed an accessible Resize and Skew dialog. A disposable blank canvas was changed from 2577×2118 to 320×240 and Paint's canvas-size label reported 320×240.

The first save demonstrated a useful negative control: typing a `.png` filename while the Save As type remained Microsoft Paint Project produced non-PNG bytes. `indro paint verify` rejected it with `INVALID_PNG`. A second attempted selection produced TIFF bytes and was also rejected. Selecting `PNG (*.png)` explicitly produced `artifacts/verified-320x240.png`.

## Independent artifact result

```json
{
  "valid": true,
  "issues": [],
  "artifact": {
    "bytes": 912,
    "sha256": "359230fb09e2f60d4bc781a2ad31003d7e930e917ab13a48e1cc457e5ae152b2",
    "width": 320,
    "height": 240
  }
}
```

The verifier reads the PNG signature and IHDR fields directly from the saved bytes. It does not trust the filename or Paint's UI state.

The capability was then retained through the canonical CLI into the experiment-scoped Continuum store:

- Capability: `paint.canvas.resize-and-export-png`
- Receipt path: `state/continuum/capabilities/paint.canvas.resize-and-export-png/2026-10-27T02-00-34-958Z-d2257c5f-bbbb-4295-b6ef-53f72818f052.json`
- Receipt SHA-256: `552fc5703d93c0b418899eb7e737c9e2ffe5149e6f4b0718e4f6682cb10c0fb7`
- Validation: reusable only when Paint version `11.2605.81.0`, verifier fingerprint, and evidence artifact all match
- Invocation classification: `autonomous: false`; requires an authorized accessibility agent

## Assessment

This establishes held-out application discovery, a typed reusable recipe, and independent artifact verification across a different control boundary from FL Studio. It does not yet establish autonomous `indro capability invoke`, fresh-agent reuse timing, or general unknown-application discovery. Those portions remain blocked by the absence of a supported Paint automation API that the local INDRO CLI can invoke. A future agent can use the retained recipe, but that transfer still requires a separately measured fresh-agent trial.
