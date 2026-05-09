# OpenWork Host (Docker)

Docker assets here cover the **micro-sandbox image** and the **production-style OpenWork Host** compose stack.

OpenWork Cloud local-dev tooling (MySQL compose, cloud API/web in Docker, hybrid scripts) is **not part of this repository** anymore.

---

## Pre-baked Micro-Sandbox Image

For micro-sandbox work, use the pre-baked image that compiles `openwork` and `openwork-server` from source and downloads the pinned `opencode` binary during `docker build`.

Build it from the repo root:

```bash
./scripts/build-microsandbox-openwork-image.sh
```

Run it locally:

```bash
docker run --rm -p 8787:8787 \
  -e OPENWORK_CONNECT_HOST=127.0.0.1 \
  openwork-microsandbox:dev
```

Defaults:
- `OPENWORK_TOKEN=microsandbox-token`
- `OPENWORK_HOST_TOKEN=microsandbox-host-token`
- `OPENWORK_APPROVAL_MODE=auto`

Verification:
- Health: `curl http://127.0.0.1:8787/health`
- Authenticated API call: `curl -H "Authorization: Bearer microsandbox-token" http://127.0.0.1:8787/workspaces`
- Docker health: `docker inspect --format '{{json .State.Health}}' <container>`

Useful overrides:
- `OPENWORK_TOKEN` — set your own client bearer token
- `OPENWORK_HOST_TOKEN` — set your own host/admin token
- `OPENWORK_CONNECT_HOST` — host name embedded in the printed connect URL
- `DOCKER_PLATFORM` — optional platform passed to `docker build`

---

## Production container

This is a minimal packaging template to run the OpenWork Host contract in a single container.

It runs:

- `opencode serve` (engine) bound to `127.0.0.1:4096` inside the container
- `openwork-server` published on `0.0.0.0:8787` via an explicit `--remote-access` launch path (the only published surface)

### Local run (compose)

From this directory:

```bash
docker compose up --build
```

Then open:

- `http://127.0.0.1:8787/ui`

### Config

Recommended env vars:

- `OPENWORK_TOKEN` (client token)
- `OPENWORK_HOST_TOKEN` (host/owner token)

Optional:

- `OPENWORK_APPROVAL_MODE=auto|manual`
- `OPENWORK_APPROVAL_TIMEOUT_MS=30000`

Persistence:

- Workspace is mounted at `/workspace`
- Host data dir is mounted at `/data` (OpenCode caches + OpenWork server config/tokens)

### Notes

- OpenCode is not exposed directly; access it via the OpenWork proxy (`/opencode/*`).
- For PaaS, replace `./workspace:/workspace` with a volume or a checkout strategy (git clone on boot).
