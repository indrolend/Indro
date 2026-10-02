# Mobile and ChatGPT remote control

The authenticated Indro MCP connector and the private iPhone SSH path are two
clients over the same local authority. They do not create separate jobs.

```text
iPhone / ChatGPT
       |
       +-- Tailscale + SSH -----------+
       |                              |
       +-- GitHub OAuth + Indro MCP --+--> CommandHUD durable run
                                              |
                                              +--> provider worker
                                              +--> retained evidence
                                              +--> Brokeman checkpoint/packet
                                              +--> ntfy attention
```

The home executor stays bound to loopback behind its authenticated tunnel. It
accepts project IDs, exact Git HEADs, CommandHUD job IDs, bounded objectives,
and literal actions. It does not accept shell commands, filesystem paths, PIDs,
credentials, packet bodies, or Base64 artifacts.

Remote lifecycle tools list projects and agents, start exact-HEAD isolated
jobs, list/get jobs, and request stop. Brokeman tools return a compact result or
publish a packet locally and return its descriptor. Packet bytes remain on the
Windows workstation for SFTP/native-file retrieval; ntfy carries attention,
not commands or artifacts.

Termius remains the general escape hatch. Normal ChatGPT use should prefer the
typed MCP tools, and normal iPhone supervision should use concise Brokeman
PowerShell commands or future Shortcuts calling the same typed operations.

## Home connector runtime

`services/commandhud-home-worker/Invoke-CommandHudHomeWorker.ps1` keeps the
existing loopback home executor and existing remotely-managed Cloudflare Tunnel
together as one bounded Windows runtime. Both bearer values are read from
Windows Credential Manager and inherited through child-process environment
blocks; neither value is written to configuration, command lines, logs,
packets, or repository state.

`CommandHudHomeControl.ps1 status|start|stop|restart` is the operator surface.
The scheduled task remains transport plumbing only: it does not own jobs,
lifecycle, Git state, evidence, or provider selection. Those remain CommandHUD
responsibilities.
