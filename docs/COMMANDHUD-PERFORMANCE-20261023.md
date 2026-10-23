# CommandHUD bounded performance intervention — 2026-10-23

## Finding

On the dirty Digital Breakdown migration repository, a direct `git rev-parse HEAD` took 46.75–50.43 ms while `hud run -- git rev-parse HEAD` took 4,040.88 ms. JSON and quiet projections still took about 3,450 ms, ruling out terminal rendering as the main cause.

`repositoryCurrency()` took 1,532.16 ms per call and ran before and after every command. It read and hashed 2,634 tracked and untracked files totaling 1,030.4 MiB each time. Git status itself took 72.62 ms.

## Correction

Repository currency still incorporates a SHA-256 digest for every non-ignored tracked and untracked file. Per-file digests are now persisted atomically and reused only when path, size, modification time, and change time are unchanged. Changed files are reread and rehashed. The aggregate currency format is versioned.

The remote MCP proxy previously forwarded every project-list request independently and failed immediately when the home executor returned HTTP 429. Read-only home calls now make at most three total attempts for HTTP 429 or 503, honor `Retry-After` with a 50–2,000 ms bound, and use exponential delay otherwise. Mutating requests are never retried. Project discovery calls are coalesced and cached for five seconds to reduce bursts.

## Measurement

Using a fresh CommandHUD state directory against the same repository and command:

| Path | Wall time |
| --- | ---: |
| Direct Git | 50.43 ms |
| CommandHUD cold cache | 2,388.14 ms |
| CommandHUD warm cache, first repeat | 827.43 ms |
| CommandHUD warm cache, second repeat | 831.51 ms |

The steady-state wrapper overhead fell about 80% from 4,040.88 ms to 827–832 ms. It remains materially slower than direct Git, so trivial exploratory reads should still use direct commands. CommandHUD remains appropriate when durable evidence and repository-currency correlation justify that overhead.

## Verification

- CommandHUD complete suite: 168/168 passed.
- Indro language suite: 3/3 Node tests and 10/10 Python self-tests passed.
- Home transport tests: bounded read retry, no mutation retry, and request coalescing passed.
- Remote service TypeScript check passed.

The observed 429 originated at the Cloudflare proxy → home-executor boundary. This change does not claim control over rate limits imposed before a request reaches the proxy.
