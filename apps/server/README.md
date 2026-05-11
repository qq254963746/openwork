# AiWork Server

Filesystem-backed API for AiWork remote clients. This package provides the AiWork server layer described in `apps/app/pr/aiwork-server.md` and is intentionally independent from the desktop app.

## Quick start

```bash
npm install -g aiwork-server
aiwork-server --workspace /path/to/workspace --approval auto
```

`aiwork-server` ships as a compiled binary, so Bun is not required at runtime.

Or from source:

```bash
pnpm --filter aiwork-server dev -- \
  --workspace /path/to/workspace \
  --approval auto
```

The server logs the client token and host token on boot when they are auto-generated.

Add `--verbose` to print resolved config details on startup. Use `--version` to print the server version and exit.

## Config file

Defaults to `~/.config/aiwork/server.json` (override with `AIWORK_SERVER_CONFIG` or `--config`).

```json
{
  "host": "127.0.0.1",
  "port": 8787,
  "approval": { "mode": "manual", "timeoutMs": 30000 },
  "workspaces": [
    {
      "path": "/Users/susan/Finance",
      "name": "Finance",
      "baseUrl": "http://127.0.0.1:4096",
      "directory": "/Users/susan/Finance"
    }
  ],
  "corsOrigins": ["http://localhost:5173"]
}
```

## Environment variables

- `AIWORK_SERVER_CONFIG` path to config JSON
- `AIWORK_HOST` / `AIWORK_PORT`
- `AIWORK_TOKEN` client bearer token
- `AIWORK_HOST_TOKEN` host approval token
- `AIWORK_APPROVAL_MODE` (`manual` | `auto`)
- `AIWORK_APPROVAL_TIMEOUT_MS`
- `AIWORK_WORKSPACES` (JSON array or comma-separated list of paths)
- `AIWORK_CORS_ORIGINS` (comma-separated list or `*`)
- `AIWORK_OPENCODE_BASE_URL`
- `AIWORK_OPENCODE_DIRECTORY`
- `AIWORK_OPENCODE_USERNAME`
- `AIWORK_OPENCODE_PASSWORD`

Token management (scoped tokens):

- `AIWORK_TOKEN_STORE` path to token store JSON (default: alongside `server.json`)

File injection / artifacts:

- `AIWORK_INBOX_ENABLED` (`1` | `0`)
- `AIWORK_INBOX_MAX_BYTES` (default: 50MB, capped)
- `AIWORK_OUTBOX_ENABLED` (`1` | `0`)

## Endpoints

- `GET /health`
- `GET /status`
- `GET /capabilities`
- `GET /whoami`
- `GET /workspaces`
- `GET /workspace/:id/config`
- `PATCH /workspace/:id/config`
- `GET /workspace/:id/events`
- `POST /workspace/:id/engine/reload`
- `GET /workspace/:id/plugins`
- `POST /workspace/:id/plugins`
- `DELETE /workspace/:id/plugins/:name`
- `GET /workspace/:id/skills`
- `POST /workspace/:id/skills`
- `GET /workspace/:id/mcp`
- `POST /workspace/:id/mcp`
- `DELETE /workspace/:id/mcp/:name`
- `GET /workspace/:id/commands`
- `POST /workspace/:id/commands`
- `DELETE /workspace/:id/commands/:name`
- `GET /workspace/:id/audit`
- `GET /workspace/:id/export`
- `POST /workspace/:id/import/preview`
- `POST /workspace/:id/import`

Token management (host/owner auth):

- `GET /tokens`
- `POST /tokens` (body: `{ "scope": "owner"|"collaborator"|"viewer", "label"?: string }`)
- `DELETE /tokens/:id`

Inbox/outbox:

- `POST /workspace/:id/inbox` (multipart upload into `.opencode/aiwork/inbox/`)
- `GET /workspace/:id/artifacts`
- `GET /workspace/:id/artifacts/:artifactId`
- `POST /workspace/:id/files/sessions`
- `POST /files/sessions/:sessionId/renew`
- `DELETE /files/sessions/:sessionId`
- `GET /files/sessions/:sessionId/catalog/snapshot`
- `GET /files/sessions/:sessionId/catalog/events`
- `POST /files/sessions/:sessionId/read-batch`
- `POST /files/sessions/:sessionId/write-batch`
- `POST /files/sessions/:sessionId/ops`

Toy UI (static assets served by the server):

- `GET /ui`
- `GET /w/:id/ui`
- `GET /ui/assets/*`

OpenCode proxy:

- `GET|POST|... /opencode/*`
- `GET|POST|... /w/:id/opencode/*`

## Approvals

All writes are gated by host approval.

Host APIs accept either:

- `X-AiWork-Host-Token: <token>` (legacy host token), or
- `Authorization: Bearer <token>` where the token scope is `owner`.

Approvals endpoints:

- `GET /approvals`
- `POST /approvals/:id` with `{ "reply": "allow" | "deny" }`

Set `AIWORK_APPROVAL_MODE=auto` to auto-approve during local development.
