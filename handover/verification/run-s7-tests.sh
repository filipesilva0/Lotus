#!/usr/bin/env bash
# Session 7 suites. From the project root:  bash handover/verification/run-s7-tests.sh
#  1. logic + flows: choices parser, plugins + plugin creator, background model, auto-rename,
#     usage analytics, folder attach filters, Library documents (fake Ollama for the model calls)
#  2. render smoke: options cards, Library tabs, usage dashboard, profile sheet, background-model setting
# Needs Node 22+, `npm install` done, and network for `npx --yes esbuild` (not a project dependency).
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
BANNER="import{createRequire}from'module';const require=createRequire(import.meta.url);"
STUB="--alias:@tauri-apps/plugin-http=./handover/verification/s5-tauri-stub.ts --external:@tauri-apps/*"
fail=0
echo "== 1/2 session 7 logic and flows"
npx --yes esbuild handover/verification/s7-tests.ts --bundle --platform=node --format=esm --outfile="$OUT/s7.mjs" --log-level=error --jsx=automatic $STUB \
  && timeout 120 node "$OUT/s7.mjs" | grep -E "✗|passed" || fail=1
echo "== 2/2 session 7 render smoke"
npx --yes esbuild handover/verification/s7-render.tsx --bundle --platform=node --format=esm --outfile="$OUT/s7r.mjs" --jsx=automatic --define:import.meta.env={} --banner:js="$BANNER" --log-level=error $STUB \
  && timeout 60 node "$OUT/s7r.mjs" | grep -E "✗|passed" || fail=1
exit $fail
