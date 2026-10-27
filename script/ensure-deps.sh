#!/bin/sh
# ensure-deps.sh: install agent-app-dev's own Node deps (idea#335).
# The App Harness (lib/harness.mjs) imports @automerge/automerge-repo from THIS
# repo's node_modules, so a checkout without `npm ci` fails every smoke test
# with ERR_MODULE_NOT_FOUND. Run this after cloning or pulling on a Pi:
#   sh script/ensure-deps.sh        (or: npm run setup)
# It is a no-op when node_modules matches package-lock.json.
set -eu
cd "$(dirname "$0")/.."
marker=node_modules/.package-lock.json
if [ -f "$marker" ] && [ -d node_modules/@automerge/automerge-repo ] \
   && cmp -s package-lock.json .deps-installed.lock 2>/dev/null; then
  exit 0
fi
npm ci --no-audit --no-fund
cp package-lock.json .deps-installed.lock
