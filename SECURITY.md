# Security

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability
reporting on this repository (Security → Report a vulnerability). You will get an
acknowledgement within a few days. Supported versions: the latest published minor of
`@openwizard/core` / `@openwizard/react`; fixes are released as patches on that line.

## Persistence and client exposure — what the library guarantees and what you must do

OpenWizard runs on servers, in browsers and at the edge, and it persists workflow state. The core guarantees:

- **Boundaries revalidate on resume.** `resumeWizard(flow, unknown)` re-runs every declared boundary (context, step inputs / outputs — including their copies on the compensation stack —, event payloads in the inbox, nested children) over the snapshot. A tampered or stale store cannot inject values that the flow's own schemas would reject.
- **Snapshots are JSON-checked before every store write; resume re-validates.** Right before `store.set` the value is walked; a `Map`, `Set`, `RegExp`, class instance, function, `bigint`, `NaN` or `undefined` array slot fails the write (`WizardError('SNAPSHOT_NOT_SERIALIZABLE')` on `onPersistError`, a `persist.failed` event, the exact path) instead of being silently distorted. A `Date` (any `toJSON()` object) is accepted only where a schema / parse boundary re-parses it on resume (`z.coerce.date()`). Values that must survive persistence are JSON values, or sit under such a boundary. `SerializedError` carries `{ name, message, code }` only — never stacks or attached data.
- **Projections are deny-by-default.** `defineProjection(flow, { expose })` sends per step only `id` / `kind` / `status` / `phase` / `attempt`; drafts, outputs, validation issues, sanitized errors, child state, context keys and the flow output cross the wire only when listed in `expose`. Review every `expose`.
- **Commands are validated.** `wizard.dispatch(cmd)` is typed by the flow (`Command<F>`); anything arriving from a transport goes through `parseCommand(flow, body)` / `parseWireCommand(flow, body)` (plain objects only, exact shape, JSON-only payloads with limits — depth ≤ 64, ≤ 10 000 values, strings ≤ 64 KiB —, every step id / event name checked against the flow, `__proto__` / `constructor` never looked up as ids) before it can affect state, and the machine still rejects what the types cannot see (`command.rejected`). The decoders never throw; a Mirror source answers `INVALID_COMMAND` values. Put a body-size limit on your HTTP / WebSocket endpoint as well.
- **Frames are validated on the client.** A Mirror runs `parseFrame` on every frame (malformed frames are ignored, a retired instance id never comes back) and rejects an ack that is not for the command it sent.

You are responsible for:

- **Key scoping.** Store keys must be tenant/flow/entity scoped (`tenant/checkout/cart_123`) and never taken verbatim from user input.
- **Single-owner persistence (v0.1).** One live wizard per store key. `Store` is plain `get / set / delete` — no compare-and-swap, lease or fencing — so two replicas resuming the same snapshot at the same time would both run its side effects. Resume on another replica only after the first instance is disposed; put a lease or a queue partition in front if your deployment cannot guarantee that. Snapshot migration is planned for v0.2.
- **Secrets stay out of the state.** Do not put credentials, card numbers or tokens you would not persist into `context`, drafts or task outputs — anything in the state is persisted and may be projected. Pass secrets through `deps` (constructed by the host, `boundary.trusted<T>()`), store only references / opaque tokens (a payment provider token, a row id) and resolve them inside hooks. `redact` is for optional, derived fields only: a redacted field that a boundary requires makes resume fail (`SNAPSHOT_INCOMPATIBLE`), and `enter` hooks of already-active steps do not run again on resume to re-derive it.
- **Authorization.** Authenticate and authorize before calling `dispatch(cmd)`, `send(event, payload)` or a Mirror source's `dispatch(wireCommand)` on behalf of a client. The library routes; it does not authenticate.
- **`boundary.trusted<T>()`.** It performs no runtime check. Use it only for data you already validated elsewhere, and leave a comment saying where.
- **Idempotency of side effects.** Tasks may re-run after retries or after a crash/resume (`retry()`); make external calls idempotent or key them.
