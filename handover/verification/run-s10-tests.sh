#!/usr/bin/env bash
# Session 10 suite: first-run setup (engine installers, recommended models, guide flow), ComfyUI
# recipes for the recommended image models, macOS menu helpers, island default.
# From the project root:  bash handover/verification/run-s10-tests.sh
# Needs Node 22+, `npm install` done, and network for `npx --yes esbuild` (not a project dependency).
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
STUB="--alias:@tauri-apps/plugin-http=./handover/verification/s5-tauri-stub.ts --external:@tauri-apps/*"
echo "== session 10 logic"
npx --yes esbuild handover/verification/s10-tests.ts --bundle --platform=node --format=esm --outfile="$OUT/s10.mjs" --log-level=error --jsx=automatic $STUB \
  && timeout 60 node "$OUT/s10.mjs" | grep -E "✗|passed"
exit "${PIPESTATUS[0]}"
