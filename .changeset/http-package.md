---
'@openwizard/http': minor
---

`@openwizard/webhooks` is now `@openwizard/http` (entries `.`, `./client`, `./nitro`; `./sse` folded
into `./client`). One assembler serves a wizard over HTTP from any `Request → Response` runtime:

- `createHTTP(flow, { runs, auth, access, projection?, receive?, idempotency?, cors?, onError? })`
  returns `{ fetch(request), openAPI(info) }`. `runs`, `auth` and `access` turn the run API on
  together; access is deny-by-default (an empty `access` throws). Routes: `POST /api/<id>` (create),
  `GET /:runId`, `GET /:runId/steps/:step`, `GET /:runId/stream` (SSE frames),
  `POST /:runId/commands`, `POST /:runId/events/<event>`, and the Mirror wire `POST /:runId/stream`.
  `runs.get(lookup)` receives `{ request, tenantId, principal, runId }`.
- `combineHTTP(sources, { cors? })` serves several `createHTTP` results and subscriptions as one
  handler and one OpenAPI document; duplicate routes, operation ids and conflicting schemas throw at
  startup. `OPTIONS` answers CORS preflight when `cors` allows the origin.
- Idempotency: the `Idempotency-Key` is scoped per API, tenant, run and route and claimed only
  after the run is found. A repeat replays the run's first answer, refusals included. A throw or a
  refusal the run never recorded releases the key, so the retry reaches the run: a durable host's
  lease or dedupe gate, a disposed run (`503 RUN_UNAVAILABLE`), or an event sent before `start()`
  (`409 FLOW_NOT_STARTED`, with `Retry-After`). The run dedupes on a
  SHA-256 of the scoped key (the event id; on a durable host also the command id, with a body
  digest), so one key on two routes, APIs or receivers never collides, across processes too. A
  durable command whose worker stopped mid-apply answers `409 IDEMPOTENCY_INTERRUPTED`: read the
  run and retry with a new key.
- The stream route's `Frame` component is a `oneOf` of the snapshot frame and the transient
  `progress` frame (a hook's `progress(value)`, sent when the projection exposes that step's
  progress). Only snapshot frames set the SSE `id`.
- Signed receivers: `receive: { events, secret, resolve, correlationId?, path?, toleranceSeconds?,
  maxBodyBytes? }` lists the receivable events explicitly; `secret` may be a list (rotation) or a
  selector; the `webhook-id`, hashed with the receiver id, is the event id. Success is
  `200 { ok, data: { delivered, buffered, seq, duplicate? } }`.
- `maxBodyBytes` (API default 64 KiB, receivers 1 MiB) is counted while the body streams in: an
  oversized upload is cancelled and answered 413, with or without `Content-Length`.
- A durable host (`@openwizard/durable`) returned from `runs.get` or `resolve` is used through its
  lease and dedupe gates; its boundary rejection answers 422 and a busy host 503.
- `createWebhookSubscriptions({ id, events, store, auth, ... })` publishes only the declared public
  events (the flow-event form and its `'inherit'` of internal machine events are removed); routes
  live under `/subscriptions/<id>`; create and rotate answer `{ ok, data: { ...subscription, secret } }`.
  Deliveries are signed with `signWebhook` (Web Crypto; no `standardwebhooks` dependency).
- OpenAPI 3.1: named components from the wizard's schemas (`<Id>Input`, `<Id><Event>Payload`,
  `<Id><View>Draft`, `<Id>Run`), discriminated command and step unions, tags and Fern groups per
  source (`<id>`, `<id>.webhooks`, `<id>.subscriptions`), operation ids `<id><Method>`, and the
  public outbound events in the `webhooks` section. The Mirror wire POST is not documented.
- `@openwizard/http/client`: `httpTransport(url, { fetch?, headers? })` is a Mirror `Transport` over
  the stream route, so `createMirror<typeof projection>({ transport })` is a typed browser client
  without code generation; `decodeServerSentEvents` moved here.
- `@openwizard/http/nitro`: `withNitro(config, { http, source, openAPI? })` mounts every generated
  path on `http.fetch` and serves the document. `withNitroAPI` and `withNitroWebhooks` are removed.
- Removed: `defineRunAPI`, `defineWebhook`, `defineWebhooks`, `defineHTTPResources`,
  `defineOutboundEvents`, the run-event form of `createWebhookSubscriptions` (`attach`, `RunWebhook*`),
  `createHTTP`'s nested `api` / `outbound` options, `mirrorHandler`.
