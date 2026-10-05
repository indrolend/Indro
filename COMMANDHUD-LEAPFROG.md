# CommandHUD leapfrog increment

This increment expands the authenticated Indro MCP doorway without replacing the existing architecture.

## Added MCP capabilities

- `commandhud.home.status`
- `commandhud.projects`
- `commandhud.repo.status`
- `commandhud.repo.log`
- `commandhud.repo.diff`
- `commandhud.source.search`
- `commandhud.verify`

## Boundaries

- GitHub OAuth remains the human/ChatGPT -> MCP boundary.
- `HOME_EXECUTOR_TOKEN` remains the Worker -> home executor boundary.
- Home executor remains bound to `127.0.0.1`.
- Project roots are used internally and are not returned by `/projects`.
- No arbitrary shell execution is exposed.
- Verification only runs a small allowlist of scripts that the target repository itself declares in `package.json`.
- Command output is bounded and processes have timeouts.

## Apply

1. Decode these files at repository root.
2. Run `node tools/apply-commandhud-leapfrog.mjs`.
3. Inspect `git diff --check` and `git diff`.
4. Type-check/test the MCP and home-worker packages using their existing package scripts.
5. Restart the home executor using its existing token-bearing service context.
6. Dry-run the Worker and confirm all tool names are in the bundle.
7. Deploy the MCP Worker.
8. Use MCP Inspector to verify `tools/list`, then invoke each read-only capability.
9. Only after live verification, commit and push.

Do not commit generated `.wrangler-dryrun/`.
