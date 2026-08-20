# Security

## Report a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting for this repository.
OpenWizard supports the latest published minor of each package and ships fixes as patch releases.

## What OpenWizard checks

- `resumeRun` rechecks the flow identity, snapshot structure, and every declared data boundary.
- A store write rejects values that cannot survive a JSON round trip. `SerializedError` contains
  only `name`, `message`, and an optional `code`.
- `defineProjection(flow, { expose })` hides context, drafts, outputs, issues, errors, child state,
  final output, and progress unless the projection lists them.
- A `select` projection may return any part of the typed state. Treat its return value as public
  wire data and review it accordingly.
- A correlation mismatch drops the input event instead of buffering it. Correlation routes data.
  It does not authenticate the sender.
- `parseCommand` and `parseWireCommand` check command shape, known ids, and JSON limits. The
  machine still rejects commands that are invalid for the current state.
- A Mirror validates each frame and ignores malformed or retired run instances.
- Incoming webhooks verify the signature before parsing the declared input-event payload.
- Outgoing callback registration rejects non-HTTPS and obvious local or private targets by
  default. Recheck endpoint policy before delivery.

## What the application must enforce

- Scope storage and run lookup by tenant, flow, and entity. Never use raw user input as a storage
  key.
- Keep one owner per core `Store` key. Use `@openwizard/durable` when another worker can take over.
- Keep credentials, card numbers, and other secrets out of context, drafts, outputs, mapped error
  data, and input-event payloads. Pass server secrets through dependencies.
- Authenticate and authorize before dispatching a command, sending an input event, or resolving a
  run for an HTTP request.
- Treat `boundary.trusted<T>()` as unchecked. Use it only for values the host constructs or has
  already validated.
- Make external task calls idempotent. Retries and crash recovery can execute a task more than
  once.
- Set HTTP body limits before calling OpenWizard decoders.
- Encrypt webhook signing secrets at rest. Scope subscriptions and delivery logs by tenant.
- Allowlist outgoing run event names. Raw events may contain context, input, output, command,
  payload, and mapped error data.
- Deduplicate incoming and outgoing webhook message ids in shared storage when more than one
  process can receive or deliver them.

See [Runtime guarantees](./packages/docs/pages/concepts/guarantees.mdx),
[Projections and the Mirror](./packages/docs/pages/concepts/projections.mdx), and
[HTTP and webhooks](./packages/docs/pages/integrations/webhooks.mdx) for the matching APIs.
