# System 01 — grant application intake

This system is a small, tenant-scoped intake and review service. An applicant
fills a resumable wizard, while a reviewer sees only the projected fields for
the same tenant. The API owns authentication and authorization; the workflow
owns transitions, validation, the five-second risk job, and restart recovery.

## Run it

From this directory:

```sh
cp .env.example .env
docker compose up --build
```

The compose file starts `postgres`, `api`, `review-worker`, and `web` and waits
for each dependency's health check. Ports are 4300 (web), 4310 (API), 4320
(worker health), and 5432 (Postgres). Demo credentials are deliberately local
only:

| Role | Bearer token | Tenant header |
| --- | --- | --- |
| applicant | `intake-applicant-demo` | `demo-grants` |
| reviewer | `intake-reviewer-demo` | `demo-grants` |

Seed and reset are restricted to local demo mode. Seed the actionable reviewer
case with the package script:

```sh
pnpm seed
```

Reset all data for the demo tenant with:

```sh
curl -X POST \
  -H "Authorization: Bearer intake-reviewer-demo" \
  -H "X-Tenant-Id: demo-grants" \
  -H "Content-Type: application/json" \
  -d '{}' \
  http://127.0.0.1:4310/api/demo/reset
```

Use `pnpm test:all` for type, unit, integration, and browser checks. The
integration and browser suites intentionally require the running Compose
stack; they fail clearly when it is absent. `pnpm dx:check` validates the drill
accounting file.

### Walkthrough

1. Open [http://127.0.0.1:4300](http://127.0.0.1:4300) and keep the seeded
   applicant/reviewer tokens shown on the page.
2. Start an application, complete consent and business profile, then add a
   beneficial owner. The draft is saved after every command.
3. Select **Seed and open reviewer demo** in another tab to inspect the
   tenant-scoped queue. The reviewer sees the projection, not raw run state.
4. For a clean run, call the reset endpoint and seed again.

![Applicant and reviewer demo home](docs/screenshots/applicant-home.png)

The screenshot is a local build smoke check of the same home screen served by
the web image.

## Architecture

```mermaid
flowchart LR
  A[Applicant browser] --> WEB[web :4300]
  R[Reviewer browser] --> WEB
  WEB -->|REST + SSE, Bearer + X-Tenant-Id| API[API :4310]
  API --> WF[OpenWizard intake flow]
  API --> DB[(Postgres :5432)]
  WF --> DB
  WF -->|risk-review job| W[review-worker :4320]
  W -->|typed completion event| WF
  API -->|SSE projected snapshots| A
  API -->|SSE projected snapshots| R
```

The browser never receives the full run context. `defineProjection` is
deny-by-default and is scoped to a trusted `Viewer`; both `run.project` and
`createMirrorSource` require the scope. The API checks role and tenant before
opening a run, and the projection removes private applicant data, reviewer
notes, raw documents, and risk-provider payloads.

The workflow is one `defineWizard(options, ({ step, view, steps }) => steps(...))`
definition in `api/workflow/flow.ts`. Pass `intakeFlow` directly to projections
and durable hosts. Local callers use `intakeFlow.create(context, { deps })`.
Dynamic `next` functions declare `targets`, so the run marks unused branches
as skipped. An explicit output selector keeps the final application result
typed as `IntakeResult` across the approval and rejection branches.

## HTTP contract

All application routes require a bearer token and `X-Tenant-Id`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | API readiness and database status |
| POST | `/api/applications` | create an applicant draft |
| GET | `/api/applications/:id` | applicant-safe projected snapshot |
| POST | `/api/applications/:id/commands` | typed wizard command |
| GET | `/api/applications/:id/events` | SSE projected snapshots |
| GET | `/api/reviewer/applications` | reviewer queue for this tenant |
| GET | `/api/reviewer/applications/:id` | reviewer-safe detail |
| POST | `/api/reviewer/applications/:id/commands` | approve, reject, or request changes |

Command responses include a stable command id, accepted/completed status, and
the current `{ epoch, seq }` version. A request includes the previous
`expectedVersion`; a stale version is rejected without changing state, while a
repeated command id replays the original response and a conflicting payload is
rejected. For example:

```json
{
  "commandId": "cmd-owner-1",
  "type": "setInput",
  "step": "beneficialOwners",
  "patch": { "owners": [{ "id": "owner-1", "name": "Ada Lovelace", "ownershipPercent": 100 }] },
  "expectedVersion": { "epoch": 1, "seq": 3 }
}
```

Malformed JSON, unknown command types, missing credentials, and cross-tenant
ids are rejected before workflow dispatch. Repeating a command id is safe.

## Failure drill

The beneficial-owner path is intentionally real: the form validates an owner
name and ownership percentage, the workflow persists the accepted input, and a
reviewer can observe the resulting state without seeing private fields. The
risk step runs for roughly five seconds in the worker. Killing and restarting
the worker resumes the persisted job; it does not create a second risk result.

The integration suite covers malformed/authenticated requests, stale commands,
SSE framing and sequence ordering, tenant isolation, projection leaks, durable
rows, worker completion, and restart recovery. The browser suite drives the
same flow through semantic labels rather than implementation-specific CSS.

### DX audit

The beneficial-owner drill is intentionally narrow. `dx-metrics.json` records
the four implementation files, the transport/recovery checks, and the measured
typecheck time. `pnpm dx:check` verifies that every listed path exists and that
the numbers are non-negative; no generated output or vendored dependency is
counted as wizard work.

The current measured transport footprint is:

| Glue | LOC | Blocks over 20 lines |
| --- | ---: | --- |
| Runtime registry `api/runtime/registry.ts` | 295 | `createIntakeRuntimeRegistry` (34–256), `createEntry` (51–112), `dispatch` (133–169), `reopenActive` (222–253) |
| SSE transport `api/http/sse.ts` | 123 | `openApplicationStream` (50–123) |
| REST routes `api/http/routes.ts` | 109 | `intakeHttpRoutes` (23–109) |
| Application/command adapter `api/application-service.ts` | 260 | `subscribe` (108–148), `commandResponse` (197–225) |

The registry also relies on cache, single-flight, generation, and shutdown
state in `@openwizard/durable`; those helpers are not counted in this row.
Intake retains lookup, auth, retry, metadata, invalidation, and projection.
These counts are kept here so the drill stays reviewable; `dx-metrics.json`
records the flow LOC and timed typecheck evidence.

## Troubleshooting

- `api` is unhealthy: check `docker compose ps` and `docker compose logs api
  postgres`. The API creates its canonical schema after Postgres becomes ready.
- The browser shows a blank page: rebuild the web image after changing
  `VITE_API_BASE_URL`; the default is empty so `/api` stays same-origin through
  nginx.
- A command returns `409`: refresh the application. The `{ epoch, seq }`
  version is stale, and retrying with the latest version is intentional.
- A risk job remains pending after a restart: confirm `review-worker` is
  healthy, then inspect `docker compose logs review-worker`; the job is leased
  from Postgres and will be reclaimed after the lease expires.
- To remove local demo data, run `docker compose down -v` (this deletes the
  named Postgres volume) and start the stack again.

## References

- [OpenWizard repository guide](../../README.md)
- [Docker Compose getting started](https://docs.docker.com/compose/gettingstarted/)
- [Fastify documentation](https://fastify.dev/docs/latest/)
- [PostgreSQL current documentation](https://www.postgresql.org/docs/current/)
- [Playwright test documentation](https://playwright.dev/docs/test-intro)
- [MDN Server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
