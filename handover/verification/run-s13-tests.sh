#!/usr/bin/env bash
# Session 13 suite (HIG pass): menu shortcuts, page commands, Undo / alerts, reply feedback, and
# render checks for the engine notice, Settings panes and reply actions.
# From the project root:  bash handover/verification/run-s13-tests.sh   (Node 22+, `npm install` done)
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
BANNER="import{createRequire}from'module';const require=createRequire(import.meta.url);"
STUB="--alias:@tauri-apps/plugin-http=./handover/verification/s5-tauri-stub.ts --external:@tauri-apps/*"
echo "== session 13"
npx --yes esbuild handover/verification/s13-tests.ts --bundle --platform=node --format=esm --outfile="$OUT/s13.mjs" --log-level=error --jsx=automatic --define:import.meta.env={} --banner:js="$BANNER" --loader:.png=dataurl $STUB \
  && timeout 60 node "$OUT/s13.mjs" | grep -E "✗|passed|      "
exit "${PIPESTATUS[0]}"
