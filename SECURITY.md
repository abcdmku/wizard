# Security

## Report a vulnerability

Use the repository's private GitHub security advisory form when possible. Do not post working exploit details in a public issue.

Include the affected package and version, a small reproduction, the impact, and any workaround you found.

## Rules for applications

OpenWizard coordinates application code. Your host still owns authentication, authorization, secrets, database access, and network policy.

### Check outside data

Use schemas for starting context, view input, event payloads, and task output that came from another system. `boundary.trusted<T>()` skips runtime checks, so use it only for values your server constructed.

### Keep dependencies on the server

Put database clients, API clients, and secrets in `deps`. Do not put them in context or step output. Snapshots contain context and step data.

### Keep snapshots tenant-scoped

Choose store keys that include the tenant and resource identity. Check the caller's tenant before loading a run. A run id by itself is not authorization.

Use the `redact` option before persistence when a snapshot contains data your store should not keep.

### Expose only selected client state

Use `defineProjection()` before sending run state to a browser. Projections expose nothing by default. Add only the context fields and step fields the UI needs.

For principal-specific output, define a scoped `select` projection and create one Mirror source per immutable authenticated principal. Authenticate the caller and perform tenant-scoped run lookup before supplying that scope. Use the source's `authorize({ state, command, scope })` policy for commands. A denial, throw, or rejection fails closed with `FORBIDDEN` and does not reach the machine.

Projection scope stays outside commands, events, snapshots, logs, frames, and acknowledgements. Do not copy a token or principal into context, view input, step output, or the selector's return value. A selector can deliberately disclose scope fields, so JSON-serialize projected frames in role and cross-tenant leak tests.

Hook `progress(value)` payloads never enter persisted state, but can disclose data to observers. A projection forwards them only through explicit per-step progress exposure. Review this allowlist separately from the selector's returned state. Root `expose.progress` exposes the completion summary only.

### Treat remote tasks as at-least-once

A task may run again after a crash. Pass its `idempotencyKey` to services that create charges, reservations, messages, or other writes. The remote service must enforce the key. Event IDs and command IDs deduplicate deliveries at their respective boundaries; they do not make external effects exactly once.

### Use durable storage for several workers

Core's `Store` assumes one live owner per key. Use `@openwizard/durable` when several processes may handle the same run. The in-memory core and durable stores are for tests and local processes.

### Verify webhooks

Keep signing secrets in a secret manager. Verify the raw request body and signature before parsing business data. `@openwizard/http` receivers (`createHTTP(wizard, { receive })`) do this before `resolve` runs.

Restrict outgoing webhook destinations to approved hosts or networks. Store message ids when duplicate delivery must be suppressed.
