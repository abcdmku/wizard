#!/usr/bin/env bash

set -Eeuo pipefail

: "${SYSTEM_NAME:?SYSTEM_NAME is required}"
: "${SYSTEM_PATH:?SYSTEM_PATH is required}"
: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"

workspace="$GITHUB_WORKSPACE"
system_dir="$workspace/$SYSTEM_PATH"

if [[ ! -d "$system_dir" ]]; then
  echo "System directory does not exist: $SYSTEM_PATH" >&2
  exit 1
fi

cd "$system_dir"

compose_file=""
for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
  if [[ -f "$candidate" ]]; then
    compose_file="$candidate"
    break
  fi
done

if [[ -z "$compose_file" ]]; then
  echo "No Compose file found in $SYSTEM_PATH" >&2
  exit 1
fi

project_name="wizard-system-${SYSTEM_NAME//[^[:alnum:]]/-}"
export COMPOSE_PROJECT_NAME="$project_name"
[[ "$COMPOSE_PROJECT_NAME" == "$project_name" ]] || { echo "Compose project name invariant failed: expected $project_name, got $COMPOSE_PROJECT_NAME" >&2; exit 1; }
compose=(docker compose --project-name "$project_name" --file "$compose_file")

log_root="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/wizard-systems/$SYSTEM_NAME"
mkdir -p "$log_root"

cleanup() {
  local status=$?

  if (( status != 0 )); then
    echo "The $SYSTEM_NAME system failed; collecting Compose diagnostics in $log_root" >&2
    "${compose[@]}" ps --all >"$log_root/compose-ps.txt" 2>&1 || true
    "${compose[@]}" logs --no-color >"$log_root/compose.log" 2>&1 || true
  fi

  "${compose[@]}" down --volumes --remove-orphans >"$log_root/compose-down.log" 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

package_manager=""
install_dependencies() {
  [[ -f package.json ]] || return 0

  if [[ -f "$workspace/pnpm-lock.yaml" ]]; then
    package_manager=pnpm
    (
      cd "$workspace"
      pnpm install --frozen-lockfile
    )
    cd "$system_dir"
  elif [[ -f pnpm-lock.yaml ]]; then
    package_manager=pnpm
    pnpm install --frozen-lockfile
  elif [[ -f yarn.lock ]]; then
    package_manager=yarn
    corepack yarn install --immutable
  elif [[ -f bun.lockb || -f bun.lock ]]; then
    package_manager=bun
    if ! command -v bun >/dev/null 2>&1; then
      echo "bun.lock* is present, but bun is not installed on the runner" >&2
      return 1
    fi
    bun install --frozen-lockfile
  elif [[ -f package-lock.json ]]; then
    package_manager=npm
    npm ci
  else
    package_manager=npm
    npm install --no-package-lock
  fi
}

package_script() {
  [[ -f package.json ]] || return 0

  node - "$@" <<'NODE'
const fs = require("node:fs");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts ?? {};
for (const candidate of process.argv.slice(2)) {
  if (Object.prototype.hasOwnProperty.call(scripts, candidate)) {
    process.stdout.write(candidate);
    break;
  }
}
NODE
}

run_package_script() {
  local script="$1"

  case "$package_manager" in
    pnpm) pnpm run "$script" ;;
    yarn) corepack yarn run "$script" ;;
    bun) bun run "$script" ;;
    npm) npm run "$script" ;;
    *)
      echo "Cannot run package script '$script': no package manager was selected" >&2
      return 1
      ;;
  esac
}

run_file() {
  local file="$1"

  case "$file" in
    *.sh) bash "$file" ;;
    *.mjs|*.js) node "$file" ;;
    *)
      echo "Unsupported CI script type: $file" >&2
      return 1
      ;;
  esac
}

run_optional_check() {
  local label="$1"
  shift
  local candidate
  local selected=""

  for candidate in "$@"; do
    if [[ -f "$candidate" ]]; then
      selected="$candidate"
      break
    fi
  done

  if [[ -n "$selected" ]]; then
    echo "Running $label check: $selected"
    run_file "$selected"
    return 0
  fi

  local package_candidates=()
  local in_package_candidates=false
  for candidate in "$@"; do
    if [[ "$candidate" == "--" ]]; then
      in_package_candidates=true
    elif [[ "$in_package_candidates" == true ]]; then
      package_candidates+=("$candidate")
    fi
  done

  if ((${#package_candidates[@]} > 0)); then
    selected="$(package_script "${package_candidates[@]}")"
    if [[ -n "$selected" ]]; then
      echo "Running $label package script: $selected"
      run_package_script "$selected"
      return 0
    fi
  fi

  echo "No optional $label check found; continuing."
}

install_dependencies

run_optional_check "build" \
  scripts/ci-build.sh scripts/build-ci.sh \
  -- ci:build build

run_optional_check "typecheck" \
  scripts/ci-typecheck.sh scripts/typecheck-ci.sh \
  -- ci:typecheck typecheck type-check check:types

run_optional_check "unit" \
  scripts/ci-unit.sh scripts/unit-ci.sh scripts/test-unit.sh \
  -- ci:unit test:unit unit:test

echo "Validating $compose_file"
"${compose[@]}" config --quiet

echo "Building and starting $SYSTEM_NAME"
"${compose[@]}" up --build --detach

is_successful_one_shot() {
  case "$1" in
    init|setup|seed|migrate|migration|deploy|pulumi|pulumi-*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_services() {
  local deadline=$((SECONDS + 180))
  local service container state health exit_code
  local pending
  local -a services=()

  mapfile -t services < <("${compose[@]}" config --services)
  if ((${#services[@]} == 0)); then
    echo "Compose defined no services" >&2
    return 1
  fi

  while ((SECONDS < deadline)); do
    pending=0
    for service in "${services[@]}"; do
      container="$("${compose[@]}" ps --all -q "$service" 2>/dev/null || true)"
      if [[ -z "$container" ]]; then
        pending=1
        continue
      fi

      read -r state health exit_code < <(
        docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.State.ExitCode}}' "$container"
      )

      case "$state" in
        running)
          case "$health" in
            starting) pending=1 ;;
            unhealthy)
              echo "Compose service '$service' is unhealthy" >&2
              return 1
              ;;
          esac
          ;;
        exited)
          if [[ "$exit_code" == 0 ]] && is_successful_one_shot "$service"; then
            echo "One-shot service '$service' completed successfully"
          elif [[ "$exit_code" != 0 ]]; then
            echo "Compose service '$service' exited with code $exit_code" >&2
            return 1
          else
            echo "Long-running Compose service '$service' exited unexpectedly" >&2
            return 1
          fi
          ;;
        *)
          pending=1
          ;;
      esac
    done

    ((pending == 0)) && return 0
    sleep 2
  done

  echo "Timed out waiting for Compose services to become healthy" >&2
  "${compose[@]}" ps --all >&2 || true
  return 1
}

wait_for_services
"${compose[@]}" ps --all

run_optional_check "seed" \
  scripts/ci-seed.sh scripts/seed-ci.sh scripts/seed.sh \
  -- ci:seed seed:ci seed

run_optional_check "integration" \
  scripts/ci-integration.sh scripts/integration-ci.sh scripts/test-integration.sh \
  -- ci:integration test:integration integration:test test:compose

if [[ -f package.json ]]; then
  case "$package_manager" in
    pnpm)
      if pnpm exec playwright --version >/dev/null 2>&1; then
        pnpm exec playwright install --with-deps chromium
      fi
      ;;
    yarn)
      if corepack yarn exec playwright --version >/dev/null 2>&1; then
        corepack yarn exec playwright install --with-deps chromium
      fi
      ;;
    bun)
      if bunx --no-install playwright --version >/dev/null 2>&1; then
        bunx --no-install playwright install --with-deps chromium
      fi
      ;;
    npm)
      if npx --no-install playwright --version >/dev/null 2>&1; then
        npx --no-install playwright install --with-deps chromium
      fi
      ;;
  esac
fi

run_optional_check "browser" \
  scripts/ci-browser.sh scripts/browser-ci.sh scripts/test-browser.sh \
  -- ci:browser test:browser test:e2e e2e

echo "$SYSTEM_NAME checks completed."
