# ChatGPT local sandbox development

CommandHUD exposes one iterative local-development protocol to ChatGPT and
other model clients. A sandbox job is a durable binding between an existing
CommandHUD job ID and a detached Git worktree created at an exact observed
commit. It is not another execution database or agent runtime.

The typed loop is:

1. `commandhud.project.state` measures current authority.
2. `commandhud.sandbox.create` creates a detached worktree at that exact HEAD.
3. `commandhud.sandbox.read` and `.search` provide narrow observation.
4. `commandhud.sandbox.patch` validates and applies a bounded unified diff.
5. `commandhud.sandbox.exec` runs a bounded argv command without a command shell.
6. `commandhud.sandbox.media` returns one contained PNG, JPEG, WebP, or GIF as
   a renderable image after independently verified byte-length and SHA-256
   transport checks. Generated evidence can remain in a repository-ignored
   directory without becoming a source change.
7. `commandhud.sandbox.diff` derives tracked and untracked changes from Git.
8. `brokeman.result` or `brokeman.packet` projects continuity from the same job.
9. `commandhud.sandbox.discard` explicitly removes only the CommandHUD-owned
   worktree while retaining job and operation evidence.

Every command is rooted by CommandHUD inside the sandbox. File paths must be
relative and contained. Each execution retains exit status, bounded output,
full stdout/stderr evidence hashes, Git-before/Git-after state, and an operation
delta. The authoritative checkout is never selected as the sandbox execution
root, and integration is deliberately not part of this initial surface.

ChatGPT conversation context may remember which project and job the user means,
but observed CommandHUD/Git state remains authoritative. A conversation can
disappear without deleting the worktree, and another client can continue the
same job by its durable ID or a Brokeman packet.
