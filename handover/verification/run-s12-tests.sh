#!/usr/bin/env bash
# Session 12 suite: first-run guide after an empty saved chat.
# From the project root:  bash handover/verification/run-s12-tests.sh
# Needs Node 22+, `npm install` done, and network for `npx --yes esbuild` (not a project dependency).
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
STUB="--alias:@tauri-apps/plugin-http=./handover/verification/s5-tauri-stub.ts --external:@tauri-apps/*"
echo "== session 12 logic"
npx --yes esbuild handover/verification/s12-tests.ts --bundle --platform=node --format=esm --outfile="$OUT/s12.mjs" --log-level=error --jsx=automatic $STUB \
  && timeout 60 node "$OUT/s12.mjs" | grep -E "✗|passed"
exit "${PIPESTATUS[0]}"
