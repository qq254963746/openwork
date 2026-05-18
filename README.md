> AiWork is the open source alternative to Claude Cowork/Codex (desktop app).

## Core Philosophy

- Local-first, cloud-ready: AiWork runs on your machine in one click. Send a message instantly.
- Composable: desktop app or server. Use what fits, no lock-in.
- Ejectable: AiWork is powered by AiWork, so everything AiWork can do works in AiWork, even without a UI yet.

AiWork is designed around the idea that you can easily ship your agentic workflows for your team as a repeatable, productized process.

## Why

Current CLI and GUIs for engine are anchored around developers. That means a focus on file diffs, tool names, and hard to extend capabilities without relying on exposing some form of cli.

AiWork is designed to be:

- **Extensible**: skill and engine plugins are installable modules.
- **Permissioned**: access to privileged flows.
- **Local**: AiWork works locally

## What’s Included

- **Host mode**: runs engine locally on your computer
- **Client mode**: connect to an existing AiWork server by URL.
- **Sessions**: create/select sessions and send prompts.
- **Live streaming**: SSE `/event` subscription for realtime updates.
- **Execution plan**: render AiWork todos as a timeline.
- **Permissions**: surface permission requests and reply (allow once / always / deny).
- **Templates**: save and re-run common workflows (stored locally).
- **Debug exports**: copy or export the runtime debug report and developer log stream from Settings -> Debug when you need to file a bug.
- **Skills manager**:
  - list installed `.engine/skills` folders
  - import a local skill folder into `.engine/skills/<skill-name>`

## Quick Start

### Requirements

- Node.js + `pnpm`
- Rust toolchain (for Tauri): install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Tauri CLI: `cargo install tauri-cli`
- AiWork CLI installed and available on PATH: `engine`

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
./script/pnpm-dev.sh
```

`pnpm dev` now enables `AIWORK_DEV_MODE=1` automatically, so desktop dev uses an isolated AiWork state instead of your personal global config/auth/data.

### Folder Picker

The folder picker uses the Tauri dialog plugin.
Capability permissions are defined in:

- `apps/desktop/src-tauri/capabilities/default.json`

## AiWork Plugins

Plugins are the **native** way to extend AiWork. AiWork now manages them from the Skills tab by
reading and writing `engine.json`.

- **Project scope**: `<workspace>/engine.json`
- **Global scope**: `~/.config/engine/engine.json` (or `$XDG_CONFIG_HOME/engine/engine.json`)

You can still edit `engine.json` manually; AiWork uses the same format as the AiWork CLI:

```json
{
  "$schema": "https://www.aiwork.love/config.json",
  "plugin": ["engine-wakatime"]
}
```

### Linux / Wayland (Hyprland)

If AiWork crashes on launch with WebKitGTK errors like `Failed to create GBM buffer`, disable dmabuf or compositing before launch. Try one of the following environment flags.

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 aiwork
```

```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 aiwork
```
