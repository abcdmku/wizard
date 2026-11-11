# ADR-003: Initialize drafts from durable state and scope projections at the host

- Status: accepted
- Date: 2026-08-23

## Context

The reference systems exposed two missing contracts.

A view previously accepted only a static initial draft. Hosts called `setInput` after entry to map persisted context into form fields. That could race with `enter`, behaved differently on reset, and spread initialization across transport code.

Projections also lacked a principal type. Hosts could authenticate a caller before loading a run, but neither a selector nor a mirror source could require the authenticated viewer. Domain code repeated untyped policy checks around each transport.

Principal data grants request authority and must stay outside workflow state. External prefill calls belong in runnable steps; view initialization maps their persisted results into a draft.

## Decision

### Dynamic view initialization

`view.initial` accepts a partial draft value or a sync/async function over parsed context and dependencies.

- Compile a function as a hook; store only its result.
- Invoke it before `enter` when no draft exists.
- Commit the resolved draft before later hooks observe it.
- Retain drafts on back navigation and resume.
- `resetInput` clears a dynamic draft and starts a new initialization generation.
- Ignore obsolete initializer results after reset or an explicit input edit.
- Treat a thrown or rejected initializer as a view hook failure.
- Keep external I/O in runnable work and use initialization to map durable data.

### Principal-scoped projections

A scoped selector declares `scope: boundary.trusted<Viewer>()`. It receives `{ state, scope }`, and `ProjectionScope<P>` extracts the principal type.

`Run.project()` requires that viewer for a scoped projection. `createMirrorSource()`, imported from `@openwizard/core/mirror`, holds one authenticated scope for its lifetime.

An optional typed `authorize({ state, command, scope })` hook runs after strict command parsing and instance checks, before machine dispatch. Denial, throw, or rejection returns a generic `FORBIDDEN` result without changing the sequence or machine log.

Scope stays out of context, commands, events, snapshots, logs, frames, and acknowledgements. A selector can deliberately return principal fields, so serialized projection tests must cover each role.

Authenticate and look up the run within its tenant before constructing the source. Neither the scope boundary nor projection grants access to a run.

### Transient progress

Hook progress is another possible data disclosure. Expose projections allow it per step through `expose.steps[id].progress`; the root progress flag exposes only the completion summary. Select projections use a separate map:

```ts
defineProjection(wizard, {
  select: (state) => ({ status: state.status }),
  progress: { work: true, nested: { child: { upload: true } } },
})
```

The map permits transient progress frames without adding fields to the selector result. Omitted step and child flags forward no hook progress.

### Extraction gates

Start a new registry or transport integration in its reference system. Extract a framework-neutral package once two systems repeat it, or one system repeats more than 20 lines of the same glue. That rule led to the durable host and HTTP packages.

Effect integration uses `runEffect` from `@openwizard/effect`, with `EffectDeps` supplied through the wizard's dependency boundary. Its non-callable run adapter preserves success and error inference and uses the ordinary `step({ run: adapter })` constructor.

Full projected snapshot frames remain the default. Patch frames require measured payloads over 25 KB or a demonstrated latency problem. Transient progress uses its own frame kind.

## Consequences

Form defaults follow normal persistence, reset, and failure rules. A scoped projection source requires a typed principal, and authorization can inspect a parsed command without moving the policy into the transport controller.

Secrets stay outside durable and wire data unless a selector explicitly returns them. Every reference system still needs tests for domain-specific non-disclosure and durable ingress deduplication.

Public declarations, examples, docs, and changesets must ship with changes to initialization, projection, or adapter contracts.
