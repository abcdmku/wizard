# Local runbook

## Start and seed

From `systems/03-fulfillment`:

```sh
docker compose up --build
```

Compose runs Pulumi once, then starts the web app at `http://localhost:4500`,
the orchestrator at `http://localhost:4510`, and the partner fixture at
`http://localhost:4520`. LocalStack is available at `http://localhost:4566`.
Inside Compose use `web:3000`, `orchestrator:3001`, `partner-api:3002`, and
`postgres:5432`.

Compose has `SEED_ON_START=true`, so it seeds the accounts and normal and
fraud-hold scenarios during the first healthy start. To rerun the idempotent
seed after a reset or test, use `pnpm seed`. Stable local tokens are
`customer-acme` and `operator-acme` for tenant `tenant-acme`, and
`customer-globex` and `operator-globex` for tenant `tenant-globex`. Run the
seed again after a test without creating a second workflow run.

## Run the fraud drill

Open the operator screen with `operator-acme` and select the seeded fraud-hold
order. Approve it to continue toward payment capture and shipping. Reject it
to run compensation. Repeating the same decision is idempotent.

Open the customer screen in a separate browser context. It should show status,
line items, totals, and tracking, but not the fraud provider reason, payment
token, signing secret, queue payload, or stack trace.

## Inspect queues and callbacks

Pulumi creates four SNS topics and three filtered service subscriptions. Each
service has a work queue, a DLQ, and a Lambda event-source mapping. Inspect the
physical resources from the LocalStack container:

```sh
docker compose exec localstack awslocal sns list-topics
docker compose exec localstack awslocal sqs list-queues
docker compose exec localstack awslocal lambda list-functions
```

Use `tests/webhook.integration.test.ts` as the callback fixture. Sign the exact
UTF-8 request body with `local-partner-webhook-secret` and include a fresh
timestamp, message ID, tenant ID, order ID, and event data. A duplicate message
ID is safe. A callback for another tenant or order is rejected. An event sent
before the shipping wait is active is buffered and applied when the run reaches
that wait.

## Inspect a run

Use the operator API or the browser. The operator projection includes branch
attempts and compensation state. The customer projection is deliberately
smaller. Do not query Postgres to bypass the projection; use the role that owns
the data.

## Reset and logs

```sh
docker compose logs --no-color orchestrator partner-api postgres localstack > tmp/failure.log
pnpm reset
docker compose up --build
# optional, idempotent rerun
pnpm seed
```

Reset removes only this Compose project's named volumes. Capture logs before
resetting a failing integration run. The LocalStack volume also contains the
local AWS-shaped resources; Pulumi recreates them if that volume is removed.

## Local infrastructure preview

The Pulumi program used by Compose is local-only. To inspect it without
starting the application containers, start LocalStack on port 4566 and run:

```sh
pnpm --dir infra local:preview
```

The helper uses `pulumilocal`, a file backend in `infra/.pulumi`, and local
credentials. It must not read cloud credentials or contact a real AWS endpoint.
Compose instead mounts the file backend at `/state` in the one-shot Pulumi
container. The Compose image is `localstack/localstack:4.4.0`; newer 2026 images
require account activation.

## Troubleshooting

- If `pulumi` exits, inspect `docker compose logs pulumi localstack` and verify
  LocalStack is healthy at `http://localstack:4566` inside Compose.
- If the orchestrator is unhealthy, inspect `docker compose logs postgres
  orchestrator`; migrations run before the health check can pass.
- If a queue is missing, inspect `docker compose logs pulumi` and list queues
  with `docker compose exec localstack awslocal sqs list-queues`. Do not run a
  second Pulumi deployment while Compose is active.
- If a callback returns `401`, sign the exact request bytes, not a parsed and
  re-serialized JSON object. Check timestamp, signature, and message ID.
- If the fraud order is stuck, refresh the operator view, check the three work
  queues and their DLQs, and confirm the `operator-acme` token.
- If Playwright cannot connect, wait for `http://localhost:4500`; the spec
  assumes the stack is already running.
