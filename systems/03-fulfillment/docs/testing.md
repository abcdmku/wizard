# Verification plan

Tests are split by the boundary they exercise. Pure tests use the production
wizard, typed fake effects, and a fake clock. Integration tests use the Compose
Postgres and LocalStack services. The Playwright spec checks behavior visible
to a customer and an operator.

| Area | Test | Protection |
| --- | --- | --- |
| wizard | `tests/wizard.test.ts` | parallel branches, join, fraud, wait, compensation |
| types | `tests/contracts.test-d.ts` | context, input, output, events, scopes, errors |
| projection | `tests/projection.test.ts` | deny-by-default fields and JSON leaks |
| restart | `tests/restart.test.ts` | snapshots, epochs, retry and stale results |
| REST | `tests/rest.integration.test.ts` | role policy, status codes, tenant scope |
| database | `tests/database.integration.test.ts` | snapshots and idempotency constraints |
| webhook | `tests/webhook.integration.test.ts` | signatures, replay, order, correlation |
| queue unit | `tests/queue.test.ts` | envelope parsing and batch failure behavior |
| queue Compose | `tests/queue.integration.test.ts`, `tests/queue-filter.integration.test.ts` | topics, queues, filters, DLQs, Lambda workers |
| browser | `tests/e2e/customer-operator.spec.ts` | customer journey and fraud drill |

## Deterministic wizard tests

The fixture imports the production `fulfillmentWizard` and uses stable UUIDs, a
fake clock, and effects that record calls. It asserts that authorization and
stock reservation run in parallel, the join waits for both, fraud review occurs
before capture, and shipping enters a wait. Advancing virtual time fires retries
and timeouts without wall-clock sleeps.

The fixture also covers:

- failure in either parallel branch and reverse compensation of completed work;
- approval and rejection from the fraud review event;
- a carrier event buffered before the wait step and drained on entry;
- an event for another order dropped by correlation;
- duplicate callback or queue delivery producing no second side effect;
- an old result ignored after retry or restart;
- a terminal run rejecting another command without calling a dependency.

Tests assert idempotency keys, task tokens, event causes, and serialized errors.
They use no unsafe casts or non-null assertions.

Unit Vitest configs use `vitest.sources.ts` to resolve every `@openwizard/*`
import to workspace source. `tsconfig.source.json` applies the same resolution
to the entire system, including its type assertions. These checks do not need
package builds and cannot pass against stale declarations. To check a workflow
change from this system directory:

```sh
pnpm exec vitest run --config vitest.config.ts tests/wizard.test.ts tests/restart.test.ts tests/projection.test.ts --maxWorkers 2
pnpm exec tsc --noEmit -p tsconfig.source.json
```

## Type and boundary tests

`contracts.test-d.ts` imports the real fulfillment wizard and checks TypeScript
inference for context, context input, task output, event payload, mapped errors,
and final output. It defines a trusted `Viewer` scope and checks the production
projection shape with `run.project(projection, scope)`. A projection from a
different wizard is rejected at the run boundary.

Runtime tests send malformed context, command, event, task output, webhook, and
queue data. They expect structured issues and stable error codes. An unknown
event name is a programmer error; a known event with a malformed payload is a
normal rejected result.

## Compose integration checks

The integration harness targets the real orchestrator at host `:4510` and the
partner API at host `:4520`; inside Compose they are `:3001` and `:3002`. SQL
assertions run through the real Postgres container. Queue assertions call
`awslocal` inside the real LocalStack container. Webhook assertions sign the
exact request bytes.

REST cases cover missing, unknown, and malformed credentials, missing role
scope, malformed JSON, invalid commands, customer and operator cross-tenant
IDs, tenant-scoped operator lists, duplicate commands, and projection
serialization. Database cases cover tenant ownership, snapshot
tables, callback audit uniqueness, and idempotency rows. Webhook cases cover a
bad signature, old timestamp, replayed ID, wrong tenant, wrong order, stale
run state, malformed envelope, and valid duplicate delivery. Queue cases cover
malformed JSON, unknown event type, mismatched SNS attributes, duplicate
receipts, service filtering, transient retry, permanent partner failure, and
batch item failures. Restart tests cover a persisted snapshot, an old task
token, approval dedupe after restart, and queued Lambda work during restart.

The integration Vitest config sets `FULFILLMENT_INTEGRATION=1` for its process.
Every integration suite is gated only by that explicit mode flag. Therefore
`pnpm test:integration` fails when Compose is absent; it cannot report a green
run by silently skipping tests.

## Browser contract

`tests/e2e/customer-operator.spec.ts` assumes the stack is already running and
uses the built-in stable tokens: the browser's customer API uses
`customer-acme` and its operator API uses `operator-acme`. It creates an order,
waits for the partner workers to bring it to the fraud checkpoint, then approves
the order and verifies the shipping wait. The customer response is checked only
through the customer UI, while the operator sees the review controls.

Run the checks from the system directory:

```sh
pnpm test
pnpm typecheck
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

The fast commands are deterministic. The integration and browser commands need
the Compose health checks and do not start or reset Docker automatically.
