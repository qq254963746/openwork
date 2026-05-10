
source "$HOME/.cargo/env"

pnpm install
pnpm release:review
pnpm bump:patch   # 或 bump:minor / bump:major
pnpm release:review

pnpm -C apps/desktop prepare:sidecar

查看版本是否对
apps/desktop/src-tauri/sidecars/aiwork-server --version

pnpm --filter @aiwork/desktop exec tauri build \
  --target aarch64-apple-darwin \
  --bundles dmg,app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'


# Release checklist

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
   - `pnpm --filter @fengai/aiwork prepare:sidecar`
4. Commit the version bump.
5. Tag and push:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`

## aiwork-orchestrator (npm + sidecars)

1. Bump versions (includes `packages/orchestrator/package.json`):
   - `pnpm bump:patch` or `pnpm bump:minor` or `pnpm bump:major`
2. Build sidecar assets and manifest:
   - `pnpm --filter aiwork-orchestrator build:sidecars`
3. Create the GitHub release for sidecars:
   - `gh release create aiwork-orchestrator-vX.Y.Z packages/orchestrator/dist/sidecars/* --repo fengai/aiwork`
4. Publish the package:
   - `pnpm --filter aiwork-orchestrator publish --access public`

## aiwork-server + opencode-router (if version changed)

- `pnpm --filter aiwork-server publish --access public`
- `pnpm --filter opencode-router publish --access public`

## Verification

- `aiwork start --workspace /path/to/workspace --check --check-events`
- `gh run list --repo fengai/aiwork --workflow "Release App" --limit 5`
- `gh release view vX.Y.Z --repo fengai/aiwork`

Use `pnpm release:review --json` when automating these checks in scripts or agents.

## npm publishing

If you want `Release App` to publish `aiwork-orchestrator`, `aiwork-server`, and `opencode-router` to npm, configure:

- GitHub Actions secret: `NPM_TOKEN` (npm automation token)

If `NPM_TOKEN` is not set, the npm publish job is skipped.
