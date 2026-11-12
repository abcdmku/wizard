# OpenWizard system 02 - fleet dispatch

This system is a small, tenant-safe dispatch console for a cold-chain drill. The API owns the
dispatch projection and intervention command; the browser consumes that projection and its SSE
stream. The bearer token selects the account. Requests do not carry a tenant or scope field.

## Run the stack

```sh
cp .env.example .env
docker compose up --build
```

The three services are `web`, `fleet-api`, and `postgres`. Compose waits for Postgres, then the API
runs its migration and seed path before `GET /health` turns green. The browser is at
`http://127.0.0.1:3000`; the API is at `http://127.0.0.1:8787`.

```mermaid
flowchart LR
  Browser[React dispatcher] -->|REST + SSE, bearer auth| HTTP[Effect HttpApi]
  subgraph API[fleet-api]
    HTTP --> Services[Effect Layers, typed services]
    Services --> Registry[Durable host registry]
    Registry --> Wizard[One Wizard per delivery]
    Simulator[Effect telemetry fibers + schedules] --> Registry
  end
  Services -->|Effect SQL| DB[(Postgres)]
  Wizard -->|snapshots, waits, timers, dedupe| DB
  Shared[packages/shared schemas] -. DTOs + routes .-> Browser
  Shared -. DTOs + routes .-> HTTP
```

The [captured dispatcher dashboard](docs/screenshots/dispatcher-dashboard.png) is a real
Compose run using the seeded Lakeshore account. It shows the live fleet map, escalation queue,
and the cold-chain intervention state used in the walkthrough below.

The API is the command boundary: the browser never chooses a tenant, and the database is the
restart boundary. Shared Effect schemas decode every HTTP payload before application code sees it.

For the implementation decisions behind this system, read the [Wizard architecture plan](../../docs/design/architecture-plan.md)
and the [scoped projections ADR](../../docs/design/adr/ADR-003-dynamic-input-and-scoped-projections.md).
The runtime uses the [official Effect status page](https://www.effect.website/) and pins Effect 4
beta 107 in every fleet package. Effect 4 is prerelease: check the [official Effect migration
guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md) before upgrading.

For local checks, install this workspace and run:

```sh
pnpm typecheck
pnpm test:unit
pnpm test:integration   # the script enables FLEET_INTEGRATION after Compose is up
pnpm test:e2e            # the script enables FLEET_E2E after Compose is up
```

## Contract

| Operation | Request | Auth | Result |
| --- | --- | --- | --- |
| `GET /health` | none | none | liveness JSON |
| `GET /api/dispatch` | optional filter query | bearer | account-scoped delivery projection |
| `GET /api/dispatch/live` | none | bearer | `text/event-stream` projection updates |
| `POST /api/deliveries/:id/interventions` | intervention JSON | bearer | command acknowledgement |

The DTOs and runtime validators live in `packages/shared`; API, web, and tests consume that one
schema source. Every active delivery carries the authoritative durable `{ epoch, seq }` version
in both REST and SSE snapshots. The browser freezes that version with its command id and sends it
as `expectedVersion`; exact retries reuse a request-derived digest, while stale or changed requests
return `409`.

The delivery definition in `apps/fleet-api/src/delivery-wizard.ts` uses `defineWizard(options,
({ step, steps }) => steps(...))`. Its Effect steps read the runtime from declared dependencies;
`makeDeliveryWizard(runtime)` binds it with `provide({ runtime })`, so local and durable run
creation use the same services. Local callers use `wizard.create(context, { scheduler })`.
Event waits return `{ done: target }`; `next` reads that output and chooses among declared
`targets`. The escalation loop keeps its five-second timeout across restarts.

A score reaches the steps that use it through `needs`: `actInitial` and `initialRoute` read
`needs.score` from `scoreInitial`, and `react` and `escalationRoute` read it from `rescore`.
The context holds the delivery identity and the state that events change while the run moves
between waits: the open anomaly (`severity`, `anomalyOpenedAtMs`, `anomalyResolved`), the last
telemetry reading, `vehicleId`, `lastActionBand` and `procedureState`. Five waits handle
`telemetry`, so no single step owns that state. The context also holds the latest `score` and
`band` for the dispatch projection, which no step reads.

Operator commands use durable `dispatch`, including event delivery commands, to preserve the
payload digest and `expectedVersion` fence. Telemetry uses `send` with `eventId` for redelivery
deduplication. A resumed owner can replay an operator command's saved result before checking a
new version fence.

## Seeded accounts and reset

The deterministic local seeded-account tokens are:

- `fleet-demo-lakeshore` - primary dispatcher account, with the Lakeshore seed deliveries.
- `fleet-demo-lakeshore-manager` - fleet manager account for P0 approvals.
- `fleet-demo-lakeshore-simulator` - simulator account used by the cold-chain drill endpoint.
- `fleet-demo-redwood` - second account, with the Redwood seed deliveries.
- `fleet-demo-seed` - seed account used by `pnpm seed` to reapply the idempotent fixture.

These are deterministic local-demo credentials, not deployment secrets. A token never grants
access to another account's delivery. To reseed from an empty database:

```sh
pnpm db:reset
docker compose up --build
```

`db:reset` removes only the Compose Postgres volume. The API seed operation is idempotent, so
restarting `fleet-api` does not duplicate deliveries.

To reseed a running API without removing its volume, run `pnpm seed`; it POSTs `/api/seed` with
the seed account and validates the returned tenant, vehicle, and delivery totals.

## Cold-chain drill

1. Start Compose and request `/api/dispatch` with `Authorization: Bearer fleet-demo-lakeshore`.
2. Subscribe to `/api/dispatch/live` with the same bearer; the web console uses this stream to
   refresh cards without polling.
3. Use `fleet-demo-lakeshore-simulator` to POST `/api/drills/cold-chain` with the delivery and
   vehicle ids from the projection, a temperature above the cargo maximum, and a unique
   `commandId`.
4. Submit the intervention shown in `FLEET_INTERVENTION_BODY` for the primary delivery.
5. Verify the second bearer cannot read or intervene on the primary delivery.
6. Restart `fleet-api`; the active procedure and intervention history remain in Postgres. The
   resumed projection publishes the host's current durable version before accepting another
   intervention.

The deterministic unit suite uses `@openwizard/core/testing`'s virtual scheduler for Wizard task
timers and Effect 4's pinned `TestClock` for Effect sleeps. No test waits for wall-clock time.

## Troubleshooting

- `fleet-api` is unhealthy: run `docker compose logs fleet-api postgres`; then `pnpm wait:api`.
- The API is healthy but the page is blank: verify the web container can reach `fleet-api:8787`;
  Compose serves the browser's `/api` requests through the nginx same-origin proxy.
- Seed data is missing: run `pnpm db:reset`, then wait for the API healthcheck before testing.
- Integration or browser tests cannot reach the stack: run `docker compose up --build`, wait for
  the API healthcheck, and rerun the package scripts. They set `FLEET_INTEGRATION` and `FLEET_E2E`
  for their respective suites.
- Playwright cannot find Chromium: run `pnpm exec playwright install chromium` once on the
  developer machine or CI worker.
- A cross-account command returns `403`; the authenticated principal never changes the tenant
  selected by the server.

## DX audit

`dx-metrics.json` is machine-readable and records the cold-chain implementation audit:

| Metric | Value |
| --- | ---: |
| Wizard-specific LOC | 45 |
| Workaround helpers | 2 |
| Unsafe casts | 1 (Drizzle peer bridge in the database adapter) |
| Explicit generics | 1 |
| Typecheck time | 11.11s (`pnpm typecheck`) |
| Drill files touched | 6 (unique system-relative paths) |

The test and docs files are intentionally separate from application code. A schema change should
start in `packages/shared`, then be consumed by the API, browser, and contract tests together.
