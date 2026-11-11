# Dungeon load profiles

Run these commands from `systems/04-dungeon`. Every profile requires a clean Dungeon database volume. Seeded parties persist across container restarts, so restarting the stack is not enough. Before each profile, recreate the stack and its volume:

```sh
pnpm reset
docker compose up --build -d
pnpm health
```

Setup rejects a health response unless it reports zero active parties before seeding.

Quick four-player smoke:

```sh
k6 run load/dungeon.k6.js
```

Short PostgreSQL diagnostic with 20 parties, 80 players, and a 250 ms drive loop:

```sh
k6 run -e DUNGEON_LOAD_PROFILE=20x4-smoke load/dungeon.k6.js
```

Short client-faithful certification with the same shape and a 100 ms drive loop:

```sh
k6 run -e DUNGEON_LOAD_PROFILE=20x4-client-smoke load/dungeon.k6.js
```

Five-minute client-faithful certification:

```sh
k6 run -e DUNGEON_LOAD_PROFILE=5m load/dungeon.k6.js
```

Client-faithful profiles wake the drive loop every 100 ms. Each VU keeps one command pending and waits for its success ACK and authoritative snapshot before sending another move.

`late_sample_vus` counts each VU once when its first strictly newer, fully validated authoritative snapshot arrives at or after 95% of the active window. Duplicate, regressed, malformed, closed, and drain-only snapshots do not count. Command completion, command-to-frame latency, and the authoritative success ratio remain success-only measurements.

## Save green evidence

[`evidence/manifest.json`](evidence/manifest.json) is the tracked record for the 250 ms diagnostic, the short 100 ms run, and the five-minute run. It pins the k6 image by SHA-256 digest. Each saved entry contains the timestamp, full Git revision and dirty flag, API and web image IDs, clean-health result, exact `DUNGEON_LOAD_RESULT`, and every evaluated threshold.

All three tracked entries are currently green. The official five-minute entry records a 171 ms command-to-frame p95, a 9.6804 Hz minimum cadence, 80 of 80 late-snapshot VUs, a 3,012-byte maximum frame, and 26 of 26 thresholds passed. Fatal ACK rejections, protocol errors, stale or unresolved commands, early closes, and oversized frames are all zero. Its manifest provenance has `git.dirty: true`; this is evidence for the recorded revision and image IDs, not a clean-worktree claim.

Use PowerShell from `systems/04-dungeon`. Set `$profile` to `20x4-smoke`, `20x4-client-smoke`, or `5m`. Start from the clean volume procedure above.

```powershell
$profile = '20x4-smoke'
$k6Digest = 'sha256:5221b620a4f874faff6e32ba597aa667c058391fe4898b1c6f6377f062c6cdec'
$log = "test-results/load-$profile.log"
New-Item -ItemType Directory -Force test-results | Out-Null

docker run --rm --add-host host.docker.internal:host-gateway `
  --mount "type=bind,src=$($PWD.Path),dst=/work" -w /work `
  "grafana/k6@$k6Digest" run `
  -e "DUNGEON_LOAD_PROFILE=$profile" `
  -e DUNGEON_API_URL=http://host.docker.internal:4410 `
  -e DUNGEON_WS_URL=ws://host.docker.internal:4410/ws `
  load/dungeon.k6.js 2>&1 | Tee-Object -Variable loadOutput
$loadOutput | Set-Content -LiteralPath $log -Encoding utf8

$apiId = docker inspect --format '{{.Image}}' (docker compose ps -q dungeon-api)
$webId = docker inspect --format '{{.Image}}' (docker compose ps -q web)
node load/capture-evidence.mjs `
  --profile $profile --result-file $log `
  --api-image-id $apiId --web-image-id $webId --k6-digest $k6Digest
```

The capture command updates only that profile's green entry. The PowerShell example writes UTF-8, with a BOM on Windows PowerShell and without one on current PowerShell. Capture also accepts preserved BOM-marked UTF-16LE logs. It rejects UTF-16BE, unsupported BOMs, invalid byte sequences, and truncated files.

Capture validates the complete configured threshold set, the zero-party health precondition, the profile shape and deadline, and immutable image identifiers before writing. A red run, malformed result, missing threshold, deadline drift, or unpinned k6 digest exits without replacing saved evidence. The writer creates and syncs a temporary file in the evidence directory, then renames it over the manifest.
