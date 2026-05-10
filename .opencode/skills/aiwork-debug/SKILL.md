---
name: aiwork-debug
description: Debug AiWork sidecars, config, and audit trail
---

## Credential check

Set these before running the HTTP checks:

- `AIWORK_SERVER_URL`
- `AIWORK_SERVER_TOKEN`
- `AIWORK_WORKSPACE_ID` (optional; use `/workspaces` to discover)

## Quick usage (read-only)

```bash
curl -s "$AIWORK_SERVER_URL/health"
curl -s "$AIWORK_SERVER_URL/capabilities" \
  -H "Authorization: Bearer $AIWORK_SERVER_TOKEN"

curl -s "$AIWORK_SERVER_URL/workspaces" \
  -H "Authorization: Bearer $AIWORK_SERVER_TOKEN"
```

## Workspace config snapshot

```bash
curl -s "$AIWORK_SERVER_URL/workspace/$AIWORK_WORKSPACE_ID/config" \
  -H "Authorization: Bearer $AIWORK_SERVER_TOKEN"
```

## Audit log (recent)

```bash
curl -s "$AIWORK_SERVER_URL/workspace/$AIWORK_WORKSPACE_ID/audit?limit=25" \
  -H "Authorization: Bearer $AIWORK_SERVER_TOKEN"
```

## OpenCode engine checks

```bash
opencode -p "ping" -f json -q
opencode mcp list
opencode mcp debug <name>
```

## DB fallback (read-only)

When the engine API is unavailable, you can inspect the SQLite db:

```bash
sqlite3 ~/.opencode/opencode.db "select id, title, status from sessions order by updated_at desc limit 5;"
sqlite3 ~/.opencode/opencode.db "select role, content from messages order by created_at desc limit 10;"
```

## Notes

- Audit logs are stored at `.opencode/aiwork/audit.jsonl` in the workspace root.
- AiWork server writes only within approved workspace roots.
