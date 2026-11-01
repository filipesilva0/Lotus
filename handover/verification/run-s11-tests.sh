#!/usr/bin/env bash
# Session 11 suite: engines on another computer, guide flow with remote engines, island reset.
# From the project root:  bash handover/verification/run-s11-tests.sh
# Needs Node 22+, `npm install` done, and network for `npx --yes esbuild` (not a project dependency).
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
STUB="--alias:@tauri-apps/plugin-http=./handover/verification/s5-tauri-stub.ts --external:@tauri-apps/*"
echo "== session 11 logic"
npx --yes esbuild handover/verification/s11-tests.ts --bundle --platform=node --format=esm --outfile="$OUT/s11.mjs" --log-level=error --jsx=automatic $STUB \
  && timeout 60 node "$OUT/s11.mjs" | grep -E "✗|passed"
exit "${PIPESTATUS[0]}"
