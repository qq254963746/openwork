source "$HOME/.cargo/env"

# ─── Code Signing & Notarization Configuration ──────────────────────────────
#
# Before first use, store your notarization credentials in Keychain:
#
#   xcrun notarytool store-credentials "aiwork-notary" \
#     --apple-id "your@apple.com" \
#     --team-id "83GM6PH58T" \
#     --password "xxxx-xxxx-xxxx-xxxx"   # App-specific password from appleid.apple.com
#
# APPLE_SIGNING_IDENTITY defaults to your Developer ID certificate.
# Override via environment variable if needed.
# ─────────────────────────────────────────────────────────────────────────────

: "${APPLE_SIGNING_IDENTITY:=Developer ID Application: Gui Hu (83GM6PH58T)}"
: "${NOTARY_KEYCHAIN_PROFILE:=aiwork-notary}"

# ─── Parse flags ─────────────────────────────────────────────────────────────
# Default: sign only. Pass --notarize to also submit for notarization.
SKIP_NOTARIZE=1
for arg in "$@"; do
  case "$arg" in
    --notarize) SKIP_NOTARIZE=0 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

pnpm install
pnpm release:review
pnpm bump:patch
pnpm release:review

pnpm -C apps/desktop prepare:sidecar

apps/desktop/src-tauri/sidecars/aiwork-server --version

# ─── Build the app bundle ────────────────────────────────────────────────────
APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" \
pnpm --filter @aiwork/desktop exec tauri build \
  --target aarch64-apple-darwin \
  --bundles dmg,app \
  --config "{\"bundle\":{\"createUpdaterArtifacts\":false,\"macOS\":{\"signingIdentity\":\"$APPLE_SIGNING_IDENTITY\",\"entitlements\":\"./entitlements.plist\"}}}"

APP_PATH="apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/AiWork.app"
DMG_PATH=$(ls apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg 2>/dev/null | head -1)

# ─── Sign the DMG (Tauri signs the .app but not always the .dmg) ─────────────
if [ -n "$DMG_PATH" ] && [ "$APPLE_SIGNING_IDENTITY" != "-" ]; then
  echo "→ Signing DMG: $DMG_PATH"
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" "$DMG_PATH"
fi

# ─── Notarize via Keychain profile ───────────────────────────────────────────
if [ "$SKIP_NOTARIZE" = "1" ]; then
  echo ""
  echo "✅ Build complete. App is signed with Developer ID (notarization skipped)."
  echo "   DMG: $DMG_PATH"
elif xcrun notarytool history --keychain-profile "$NOTARY_KEYCHAIN_PROFILE" &>/dev/null; then
  if [ -n "$DMG_PATH" ]; then
    echo "→ Submitting DMG for notarization: $DMG_PATH"
    xcrun notarytool submit "$DMG_PATH" \
      --keychain-profile "$NOTARY_KEYCHAIN_PROFILE" \
      --wait

    echo "→ Stapling notarization ticket to DMG..."
    xcrun stapler staple "$DMG_PATH"
  fi

  echo "→ Stapling notarization ticket to .app..."
  xcrun stapler staple "$APP_PATH"

  echo ""
  echo "✅ Build complete. App is signed and notarized."
  echo "   DMG: $DMG_PATH"
else
  echo ""
  echo "✅ Build complete. App is signed with Developer ID."
  echo "   ⚠️  Notarization skipped: Keychain profile '$NOTARY_KEYCHAIN_PROFILE' not found."
  echo "   Run the following to set it up:"
  echo "     xcrun notarytool store-credentials \"$NOTARY_KEYCHAIN_PROFILE\" \\"
  echo "       --apple-id \"your@apple.com\" \\"
  echo "       --team-id \"83GM6PH58T\" \\"
  echo "       --password \"xxxx-xxxx-xxxx-xxxx\""
  echo "   DMG: $DMG_PATH"
fi
