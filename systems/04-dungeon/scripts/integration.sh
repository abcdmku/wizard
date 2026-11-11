#!/usr/bin/env bash
set -Eeuo pipefail

system_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$system_root"

eval "$(node scripts/load-env.mjs --shell)"

integration_assignments="$(node scripts/integration-resources.mjs --shell)"
eval "$integration_assignments"
compose=(docker compose -p "$DUNGEON_INTEGRATION_PROJECT" -f compose.yaml)
export DUNGEON_API_URL="${DUNGEON_API_URL:-http://127.0.0.1:${DUNGEON_API_PORT:-4410}}"
export DUNGEON_WS_URL="${DUNGEON_WS_URL:-ws://127.0.0.1:${DUNGEON_API_PORT:-4410}/ws}"

cleanup() {
  if [[ "${DUNGEON_KEEP_STACK:-0}" != "1" ]]; then
    "${compose[@]}" down --volumes --remove-orphans
  else
    echo "Integration stack kept. Clean it up later with:"
    echo "DUNGEON_INTEGRATION_PROJECT='${DUNGEON_INTEGRATION_PROJECT}' DUNGEON_INTEGRATION_DB_VOLUME='${DUNGEON_DB_VOLUME}' DUNGEON_INTEGRATION_NETWORK_NAME='${DUNGEON_NETWORK_NAME}' pnpm reset:integration"
  fi
}
trap cleanup EXIT INT TERM

"${compose[@]}" up --build -d
node scripts/wait-for-health.mjs
node scripts/seed.mjs

required_tests=(
  tests/integration/websocket.integration.test.ts
  tests/integration/postgres-restart.integration.test.ts
)
for test_file in "${required_tests[@]}"; do
  if [[ ! -f "$test_file" ]]; then
    echo "Missing required integration test: $test_file" >&2
    exit 1
  fi
done
pnpm exec vitest run --config vitest.config.ts --project integration
