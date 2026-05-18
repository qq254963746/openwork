Release checklist

AiWork releases should be deterministic, easy to reproduce, and fully verifiable with CLI tooling.

## Preflight

- Sync the default branch (currently `dev`).
- Run `pnpm release:review` and fix any mismatches.
- If you are building sidecar assets, set `SOURCE_DATE_EPOCH` to the tag timestamp for deterministic manifests.

## App release (desktop)

1. Bump versions (app + desktop + Tauri + Cargo):

   - `pnpm bump:patch` or `pnpm bump:minor` or `pnpm bump:major`
2. Re-run `pnpm release:review`.
3. Build sidecars for the desktop bundle:

   - `pnpm --filter @aiworklove/aiwork prepare:sidecar`
4. Commit the version bump.
5. Tag and push:

   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`

## aiwork-server (if version changed)

- `pnpm --filter aiwork-server publish --access public`
