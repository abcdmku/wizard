# LocalStack infrastructure

This Pulumi program creates the fulfillment SNS topics, filtered SQS work
queues, dead-letter queues, worker Lambdas, and SQS event-source mappings. It is
local-only. The entrypoint always uses `pulumilocal` and stores state under
`infra/.pulumi` instead of Pulumi Cloud. The Compose runner supplies
`PULUMI_BACKEND_URL=file:///state`, so its mounted `/state` volume holds the
same local backend across one-shot containers.

Compose pins LocalStack 4.4.0. LocalStack images released after March 23, 2026
require an account token even for local emulation; 4.4.0 is the last release
that preserves this system's account-free setup.

Install the Pulumi CLI and the LocalStack wrapper, then install both Node
packages:

```sh
python -m pip install -r infra/requirements.txt
pnpm --dir lambdas install
pnpm --dir infra install
```

From `systems/03-fulfillment`, run:

```sh
pnpm --dir infra local:preview
pnpm --dir infra local:up
pnpm --dir infra local:outputs
pnpm --dir infra local:destroy
```

The script builds the Lambda bundles before preview, deploy, or destroy. It sets
`PULUMI_BACKEND_URL` to an absolute `file://` URL, selects the `local` stack,
and supplies local-only AWS credentials. LocalStack must already be listening on
port 4566.

The program creates an explicit AWS provider and routes only IAM, Lambda, Logs,
SNS, SQS, and STS to `AWS_ENDPOINT_URL`. `pulumilocal` 1.3 discovers endpoint
names newer than `@pulumi/aws` 7.41.0 understands. The explicit provider keeps
the wrapper as the deployment entrypoint without creating a default provider
from that incompatible generated endpoint list.

`Pulumi.local.yaml` configures the partner API, the orchestration callback, the
HTTP timeout, queue visibility, and redrive count. The callback signing secret
is local development data. Do not reuse it outside this Compose stack.

Stack outputs include all four topic ARNs, three work queue URLs, three
dead-letter queue URLs, three worker function names, and the callback URL. The
physical names are deterministic, so Compose can also use these values before a
deployment output handoff:

```text
fulfillment-{order,payment,inventory,shipping}
fulfillment-{payment,inventory,shipping}-work
fulfillment-{payment,inventory,shipping}-dlq
fulfillment-{payment,inventory,shipping}-worker
```

LocalStack starts Lambda runtimes in separate containers. Compose must mount the
Docker socket and set `LAMBDA_DOCKER_NETWORK=openwizard-fulfillment` so the
workers can resolve `partner-api` and `orchestrator` by service name.

Compose can build `infra/Dockerfile` from the system directory. That one-shot
image includes Pulumi and `pulumilocal`, uses `http://localstack:4566`, and keeps
the file backend at `/state`. Mount a named volume there so later runs reuse the
same stack state.
