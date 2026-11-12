# DX evaluation: fraud-review drill

The drill is a fraud-review change: the run waits after the parallel payment
and inventory branches, an operator decides, and the customer projection stays
tenant-safe. Counts below were remeasured after the durable host-registry
migration on 2026-08-23 with `Get-Content`
physical lines, including blank lines and comments.
The recorded Wizard LOC for the drill is 79. The physical fraud-review block
in `packages/domain/src/readiness-steps.ts` is lines 149-192 (44 lines); that
block count is a review aid, not the machine metric and not the size of the
whole domain package.

These measurements describe the August drill, before the October authoring API
migration. The current workflow uses bound step factories inside `defineWizard`
and separates configuration into `wizard-options.ts`. The source typecheck
in `docs/testing.md` verifies that migration; the historical timing below does
not measure it.

| Metric | Measured value | Method |
| --- | ---: | --- |
| `wizardLoc` | 79 | recorded fraud-review drill implementation LOC |
| `workaroundHelpers` | 0 | no helper exists only to bypass a missing type |
| `casts` | 0 | no `as any`, `as unknown`, or non-null assertion in the drill |
| `explicitGenerics` | 0 | no explicit generic was added by the drill |
| `typecheckMs` | 2495 | measured domain typecheck from the backend handoff |
| changed-file target | 6 | the six paths below are the candidate drill set |

## Six-file change drill

| Path | Physical LOC | Why it is in the drill |
| --- | ---: | --- |
| `packages/contracts/src/order-input.ts` | 40 | customer command shape |
| `packages/domain/src/events.ts` | 17 | fraud decision event shape |
| `packages/domain/src/readiness-steps.ts` | 193 | parallel join and fraud wait |
| `packages/domain/src/projections.ts` | 188 | customer/operator scope and leak boundary |
| `apps/orchestrator/src/operator-routes.ts` | 46 | operator decision route and policy |
| `tests/wizard.test.ts` | 233 | deterministic approval/rejection proof |

These are existing handwritten paths, not a claim that all six change on every
edit. A normal fraud-review change should stay at or below six touched files.
The browser and REST assertions are additional when the wire behavior changes;
record that expansion rather than hiding it in a helper.

## Shared-host and HTTP extraction gate

Blocks over 20 physical lines are the candidates that deserve a shared host or
HTTP extraction review. The count is the complete named block, not only changed
lines.

| Concern | File and block | LOC | Over 20? |
| --- | --- | ---: | :---: |
| instance registry | `apps/orchestrator/src/registry.ts` `DurableOrderRegistry` lines 42-176 | 135 | yes |
| SNS transport | `apps/orchestrator/src/sns-gateway.ts` `SnsPartnerGateway` lines 33-104 | 72 | yes |
| webhook verification | `apps/orchestrator/src/webhook.ts` `verifyPartnerDelivery` lines 23-50 | 28 | yes |
| webhook route | `apps/orchestrator/src/webhook-route.ts` `registerWebhookRoute` lines 6-29 | 24 | yes |
| durable create command | `apps/orchestrator/src/application-service.ts` `createOrder` lines 62-107 | 46 | yes |
| durable cancel command | `apps/orchestrator/src/application-service.ts` `cancelOrder` lines 125-150 | 26 | yes |
| fraud command | `apps/orchestrator/src/application-service.ts` `reviewFraud` lines 168-202 | 35 | yes |
| callback command | `apps/orchestrator/src/application-service.ts` `receivePartnerCallback` lines 204-236 | 33 | yes |
| HTTP app glue | `apps/orchestrator/src/server.ts` `createOrchestratorApp` lines 20-82 | 63 | yes |
| small HTTP helpers | `apps/orchestrator/src/http.ts` whole file | 30 | yes |

The full-file counts are registry 206, SNS gateway 105, webhook verifier 57,
webhook route 29, application service 259, server 83, and HTTP helpers 30.
All remain below the 300-line source limit. The extraction gate is a design
review signal: do not split a block merely to make the metric smaller, and do
not add a generic host or HTTP layer without a second concrete consumer.

## Measurement commands

```sh
pnpm typecheck
pnpm test
pnpm dx:audit
```

`dx-audit.mjs` checks the 300-line limit, unsafe assertions, and the required
machine-readable `dx-metrics.json`. The root manifest owns that JSON file; this
document records the evidence and method without claiming a DX audit passed.
