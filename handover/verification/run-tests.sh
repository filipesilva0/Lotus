#!/usr/bin/env bash
# Runs the three TypeScript test suites (no Windows needed). From the project root:
#   bash handover/verification/run-tests.sh
# Needs Node 22+ and network access for `npx --yes esbuild` (esbuild is intentionally not a project dependency).
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
BANNER="import{createRequire}from'module';const require=createRequire(import.meta.url);"
build() { npx --yes esbuild "$1" --bundle --platform=node --format=esm --outfile="$2" --log-level=error --jsx=automatic --banner:js="$BANNER"; }

fail=0
echo "== 1/3 research engine (fake Ollama on :18998, fake arXiv/PubMed/OpenAlex/Crossref via patched fetch; includes a ~3 s rate-limit test)"
build handover/verification/rtest.ts "$OUT/rtest.mjs" && timeout 180 node "$OUT/rtest.mjs" | grep -E "FAIL|passed|FAILED" || fail=1

echo "== 2/3 research UI render smoke test (server-side render of every research view)"
build handover/verification/ui.tsx "$OUT/ui.mjs" && timeout 90 node "$OUT/ui.mjs" | grep -E "FAIL|passed|FAILED" || fail=1

echo "== 3/3 service clients (Ollama / Voicebox / ComfyUI against mock servers on :18999)"
build handover/verification/test.ts "$OUT/test.mjs"
timeout 60 node handover/verification/mock.mjs > "$OUT/mock.log" 2>&1 &
MOCK=$!; sleep 1.5
timeout 60 node "$OUT/test.mjs" | grep -E "FAIL|passed|FAILED" || fail=1
kill "$MOCK" 2>/dev/null
exit $fail
