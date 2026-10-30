#!/usr/bin/env bash
# App Builder + model download + LoRA tests (34). From the project root:
#   bash handover/verification/run-builder-tests.sh
# Needs Node 22+, `npm install` done, and network for `npx --yes esbuild` (not a project dependency).
# Transpiles src/ file by file to CommonJS in a temp folder (no bundling), then runs builder-tests.cjs against it.
set -u
cd "$(dirname "$0")/../.."
OUT="$(mktemp -d)"
FILES=$(find src -name '*.ts' -o -name '*.tsx')
npx --yes esbuild $FILES --outdir="$OUT" --outbase=src --format=cjs --platform=node --jsx=automatic --log-level=error || exit 1
LOTUS_OUT="$OUT" NODE_PATH="$PWD/node_modules" timeout 120 node handover/verification/builder-tests.cjs
