#!/usr/bin/env bash
# Session 5 suites. From the project root:  bash handover/verification/run-s5-tests.sh
#  1. logic + flows (56): VRAM scaler, GFM, cron, Kanban, memory/skill parsers, recall, web parsing,
#     context files, agent pool, Thinking mode / memory learning / skill writing / task agent against a fake Ollama
#  2. render smoke (13): server-side render of every new screen and settings panel
# Needs Node 22+, `npm install` done, and network for `npx --yes esbuild` (not a project dependency).
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
BANNER="import{createRequire}from'module';const require=createRequire(import.meta.url);"
STUB="--alias:@tauri-apps/plugin-http=./handover/verification/s5-tauri-stub.ts --external:@tauri-apps/*"
fail=0
echo "== 1/2 session 5 logic and flows"
npx --yes esbuild handover/verification/s5-tests.ts --bundle --platform=node --format=esm --outfile="$OUT/s5.mjs" --log-level=error $STUB \
  && timeout 120 node "$OUT/s5.mjs" | grep -E "✗|passed" || fail=1
echo "== 2/2 session 5 render smoke"
npx --yes esbuild handover/verification/s5-render.tsx --bundle --platform=node --format=esm --outfile="$OUT/s5r.mjs" --jsx=automatic --banner:js="$BANNER" --log-level=error $STUB \
  && timeout 60 node "$OUT/s5r.mjs" | grep -E "✗|passed" || fail=1
exit $fail
