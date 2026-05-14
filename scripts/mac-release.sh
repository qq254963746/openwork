source "$HOME/.cargo/env"

pnpm install
pnpm release:review
pnpm bump:patch
pnpm release:review

pnpm -C apps/desktop prepare:sidecar

apps/desktop/src-tauri/sidecars/aiwork-server --version

pnpm --filter @aiwork/desktop exec tauri build \
  --target aarch64-apple-darwin \
  --bundles dmg,app \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'