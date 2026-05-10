> AiWork is the open source alternative to Claude Cowork/Codex (desktop app).


## Core Philosophy

- Local-first, cloud-ready: AiWork runs on your machine in one click. Send a message instantly.
- Composable: desktop app, Slack/Telegram connector, or server. Use what fits, no lock-in.
- Ejectable: AiWork is powered by OpenCode, so everything OpenCode can do works in AiWork, even without a UI yet.

AiWork is designed around the idea that you can easily ship your agentic workflows for your team as a repeatable, productized process.


## Why

Current CLI and GUIs for opencode are anchored around developers. That means a focus on file diffs, tool names, and hard to extend capabilities without relying on exposing some form of cli.

AiWork is designed to be:

- **Extensible**: skill and opencode plugins are installable modules.
- **Auditable**: show what happened, when, and why.
- **Permissioned**: access to privileged flows.
- **Local**: AiWork works locally

## What’s Included

- **Host mode**: runs opencode locally on your computer
- **Client mode**: connect to an existing OpenCode server by URL.
- **Sessions**: create/select sessions and send prompts.
- **Live streaming**: SSE `/event` subscription for realtime updates.
- **Execution plan**: render OpenCode todos as a timeline.
- **Permissions**: surface permission requests and reply (allow once / always / deny).
- **Templates**: save and re-run common workflows (stored locally).
- **Debug exports**: copy or export the runtime debug report and developer log stream from Settings -> Debug when you need to file a bug.
- **Skills manager**:
  - list installed `.opencode/skills` folders
  - import a local skill folder into `.opencode/skills/<skill-name>`

## Quick Start

### Requirements

- Node.js + `pnpm`
- Rust toolchain (for Tauri): install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Tauri CLI: `cargo install tauri-cli`
- OpenCode CLI installed and available on PATH: `opencode`

### Local Dev Prerequisites (Desktop)

Before running `pnpm dev`, ensure these are installed and active in your shell:

- Node + pnpm (repo uses `pnpm@10.27.0`)
- **Bun 1.3.9+** (`bun --version`)
- Rust toolchain (for Tauri), with Cargo from current `rustup` stable (supports `Cargo.lock` v4)
- Xcode Command Line Tools (macOS)
- On Linux, WebKitGTK 4.1 development packages so `pkg-config` can resolve `webkit2gtk-4.1` and `javascriptcoregtk-4.1`

### One-minute sanity check

Run from repo root:

```bash
git checkout dev
git pull --ff-only origin dev
pnpm install --frozen-lockfile

which bun
bun --version
pnpm --filter @aiwork/desktop exec tauri --version
```

### Install

```bash
pnpm install
```

AiWork now lives in `apps/app` (UI) and `apps/desktop` (desktop shell).

### Run (Desktop)

```bash
pnpm dev
```

`pnpm dev` now enables `AIWORK_DEV_MODE=1` automatically, so desktop dev uses an isolated OpenCode state instead of your personal global config/auth/data.

### Run (Web UI only)

```bash
pnpm dev:ui
```

All repo `dev` entrypoints now opt into the same dev-mode isolation so local testing uses the AiWork-managed OpenCode state consistently.

### Arch Users:

```bash
sudo pacman -S --needed webkit2gtk-4.1
curl -fsSL https://opencode.ai/install | bash -s -- --version "$(node -e "const fs=require('fs'); const parsed=JSON.parse(fs.readFileSync('constants.json','utf8')); process.stdout.write(String(parsed.opencodeVersion||'').trim().replace(/^v/,''));")" --no-modify-path
```

## Architecture (high-level)

- In **Host mode**, AiWork runs a local host stack and connects the UI to it.
  - Default runtime: `aiwork` (installed from `aiwork-orchestrator`), which orchestrates `opencode`, `aiwork-server`, and optionally `opencode-router`.
  - Fallback runtime: `direct`, where the desktop app spawns `opencode serve --hostname 127.0.0.1 --port <free-port>` directly.

When you select a project folder, AiWork runs the host stack locally using that folder and connects the desktop UI.
This lets you run agentic workflows, send prompts, and see progress entirely on your machine

- The UI uses `@opencode-ai/sdk/v2/client` to:
  - connect to the server
  - list/create sessions
  - send prompts
  - subscribe to SSE events(Server-Sent Events are used to stream real-time updates from the server to the UI.)
  - read todos and permission requests

## Folder Picker

The folder picker uses the Tauri dialog plugin.
Capability permissions are defined in:

- `apps/desktop/src-tauri/capabilities/default.json`

## OpenCode Plugins

Plugins are the **native** way to extend OpenCode. AiWork now manages them from the Skills tab by
reading and writing `opencode.json`.

- **Project scope**: `<workspace>/opencode.json`
- **Global scope**: `~/.config/opencode/opencode.json` (or `$XDG_CONFIG_HOME/opencode/opencode.json`)

You can still edit `opencode.json` manually; AiWork uses the same format as the OpenCode CLI:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-wakatime"]
}
```

## Useful Commands

```bash
pnpm dev
pnpm dev:ui
pnpm typecheck
pnpm build
pnpm build:ui
pnpm test:e2e
```

## Troubleshooting

If you need to report a desktop or session bug, open Settings -> Debug and export both the runtime debug report and developer logs before filing an issue.

### Linux / Wayland (Hyprland)

If AiWork crashes on launch with WebKitGTK errors like `Failed to create GBM buffer`, disable dmabuf or compositing before launch. Try one of the following environment flags.

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 aiwork
```

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 aiwork
```

## Security Notes

- AiWork hides model reasoning and sensitive tool metadata by default.
- Host mode binds to `127.0.0.1` by default.
