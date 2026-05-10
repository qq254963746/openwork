# AiWork Orchestrator

Host orchestrator for opencode + AiWork server + opencode-router. This is a CLI-first way to run host mode without the desktop UI.

Published on npm as `aiwork-orchestrator` and installs the `aiwork` command.

## Quick start

```bash
npm install -g aiwork-orchestrator
aiwork start --workspace /path/to/workspace --approval auto
```

When run in a TTY, `aiwork` shows an interactive status dashboard with service health, ports, and
connection details. Use `aiwork serve` or `--no-tui` for log-only mode.

```bash
aiwork serve --workspace /path/to/workspace
```

`aiwork` ships as a compiled binary, so Bun is not required at runtime.

If npm skips the optional platform package, `postinstall` falls back to downloading the matching
binary from the `aiwork-orchestrator-v<version>` GitHub release. Override the download host with
`AIWORK_ORCHESTRATOR_DOWNLOAD_BASE_URL` when you need to use a mirror.

`aiwork` downloads and caches the `aiwork-server`, `opencode-router`, and `opencode` sidecars on
first run using a SHA-256 manifest. Use `--sidecar-dir` or `AIWORK_SIDECAR_DIR` to control the
cache location, and `--sidecar-base-url` / `--sidecar-manifest` to point at a custom host.

Use `--sidecar-source` to control where `aiwork-server` and `opencode-router` are resolved
(`auto` | `bundled` | `downloaded` | `external`), and `--opencode-source` to control
`opencode` resolution. Set `AIWORK_SIDECAR_SOURCE` / `AIWORK_OPENCODE_SOURCE` to
apply the same policies via env vars.

By default the manifest is fetched from
`https://github.com/qq254963746/aiwork/releases/download/aiwork-orchestrator-v<version>/aiwork-orchestrator-sidecars.json`.

OpenCode Router is optional. If it exits, `aiwork` continues running unless you pass
`--opencode-router-required` or set `AIWORK_OPENCODE_ROUTER_REQUIRED=1`.

For development overrides only, set `AIWORK_ALLOW_EXTERNAL=1` or pass `--allow-external` to use
locally installed `aiwork-server` or `opencode-router` binaries.

Add `--verbose` (or `AIWORK_VERBOSE=1`) to print extra diagnostics about resolved binaries.

OpenCode hot reload is enabled by default when launched via `aiwork`.
Tune it with:

- `--opencode-hot-reload` / `--no-opencode-hot-reload`
- `--opencode-hot-reload-debounce-ms <ms>`
- `--opencode-hot-reload-cooldown-ms <ms>`

Equivalent env vars:

- `AIWORK_OPENCODE_HOT_RELOAD` (router mode)
- `AIWORK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `AIWORK_OPENCODE_HOT_RELOAD_COOLDOWN_MS`
- `AIWORK_OPENCODE_HOT_RELOAD` (start/serve mode)
- `AIWORK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `AIWORK_OPENCODE_HOT_RELOAD_COOLDOWN_MS`

Or from source:

```bash
pnpm --filter aiwork-orchestrator dev -- \
  start --workspace /path/to/workspace --approval auto --allow-external
```

When `AIWORK_DEV_MODE=1` is set, orchestrator uses an isolated OpenCode dev state for config, auth, data, cache, and state. AiWork's repo-level `pnpm dev` commands enable this automatically so local development does not reuse your personal OpenCode environment.

The command prints pairing URLs by default and withholds live credentials from stdout to avoid leaking them into shell history or collected logs. Use `--json` only when you explicitly need the raw pairing secrets in command output.

Use `--detach` to keep services running and exit the dashboard. The detach summary includes the
AiWork URL and a redacted `opencode attach` command, while keeping live credentials out of the detached summary.

## Sandbox mode (Docker / Apple container)

`aiwork` can run the sidecars inside a Linux container boundary while still mounting your workspace
from the host.

```bash
# Auto-pick sandbox backend (prefers Apple container on supported Macs)
aiwork start --sandbox auto --workspace /path/to/workspace --approval auto

# Explicit backends
aiwork start --sandbox docker --workspace /path/to/workspace --approval auto
aiwork start --sandbox container --workspace /path/to/workspace --approval auto
```

Notes:

- `--sandbox auto` prefers Apple `container` on supported Macs (arm64), otherwise Docker.
- Docker backend requires `docker` on your PATH.
- Apple container backend requires the `container` CLI (https://github.com/apple/container).
- In sandbox mode, sidecars are resolved for a Linux target (and `--sidecar-source` / `--opencode-source`
  are effectively `downloaded`).
- Custom `--*-bin` overrides are not supported in sandbox mode yet.
- Use `--sandbox-image` to pick an image with the toolchain you want available to OpenCode.
- Use `--sandbox-persist-dir` to control the host directory mounted at `/persist` inside the container.

### Extra mounts (allowlisted)

You can add explicit, validated mounts into `/workspace/extra/*`:

```bash
aiwork start --sandbox auto --sandbox-mount "/path/on/host:datasets:ro" --workspace /path/to/workspace
```

Additional mounts are blocked unless you create an allowlist at:

- `~/.config/aiwork/sandbox-mount-allowlist.json`

Override with `AIWORK_SANDBOX_MOUNT_ALLOWLIST`.

## Logging

`aiwork` emits a unified log stream from OpenCode, AiWork server, and opencode-router. Use JSON format for
structured, OpenTelemetry-friendly logs and a stable run id for correlation.

```bash
AIWORK_LOG_FORMAT=json aiwork start --workspace /path/to/workspace
```

Use `--run-id` or `AIWORK_RUN_ID` to supply your own correlation id.

OpenCode runs at `INFO` by default, which produces large log files in
`~/.local/share/opencode/log/`. Pass `--opencode-log-level <DEBUG|INFO|WARN|ERROR>` (or set
`AIWORK_OPENCODE_LOG_LEVEL`) to forward `--log-level` to managed `opencode serve` and reduce log
volume.

AiWork server logs every request with method, path, status, and duration. Disable this when running
`aiwork-server` directly by setting `AIWORK_LOG_REQUESTS=0` or passing `--no-log-requests`.

## Router daemon (multi-workspace)

The router keeps a single OpenCode process alive and switches workspaces JIT using the `directory` parameter.

```bash
aiwork daemon start
aiwork workspace add /path/to/workspace-a
aiwork workspace add /path/to/workspace-b
aiwork workspace list --json
aiwork workspace path <id>
aiwork instance dispose <id>
```

Use `AIWORK_DATA_DIR` or `--data-dir` to isolate router state in tests.

## Pairing notes

- Use the **AiWork connect URL** and **client token** to connect a remote AiWork client.
- The AiWork server advertises the **OpenCode connect URL** plus optional basic auth credentials to the client.

## Approvals (manual mode)

```bash
aiwork approvals list \
  --aiwork-url http://<host>:8787 \
  --host-token <token>

aiwork approvals reply <id> --allow \
  --aiwork-url http://<host>:8787 \
  --host-token <token>
```

## Health checks

```bash
aiwork status \
  --aiwork-url http://<host>:8787 \
  --opencode-url http://<host>:4096
```

## File sessions (JIT catalog + batch read/write)

Create a short-lived workspace file session and sync files in batches:

```bash
# Create writable session
aiwork files session create \
  --aiwork-url http://<host>:8787 \
  --token <client-token> \
  --workspace-id <workspace-id> \
  --write \
  --json

# Fetch catalog snapshot
aiwork files catalog <session-id> \
  --aiwork-url http://<host>:8787 \
  --token <client-token> \
  --limit 200 \
  --json

# Read one or more files
aiwork files read <session-id> \
  --aiwork-url http://<host>:8787 \
  --token <client-token> \
  --paths "README.md,notes/todo.md" \
  --json

# Write a file (inline content or --file)
aiwork files write <session-id> \
  --aiwork-url http://<host>:8787 \
  --token <client-token> \
  --path notes/todo.md \
  --content "hello from aiwork" \
  --json

# Watch change events and close session
aiwork files events <session-id> --aiwork-url http://<host>:8787 --token <client-token> --since 0 --json
aiwork files session close <session-id> --aiwork-url http://<host>:8787 --token <client-token> --json
```

## Smoke checks

```bash
aiwork start --workspace /path/to/workspace --check --check-events
```

This starts the services, verifies health + SSE events, then exits cleanly.

## Local development

Point to source CLIs for fast iteration:

```bash
aiwork start \
  --workspace /path/to/workspace \
  --allow-external \
  --aiwork-server-bin apps/server/src/cli.ts \
  --opencode-router-bin apps/opencode-router/dist/cli.js
```
