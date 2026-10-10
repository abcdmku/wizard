# Machine specification (decide / apply / plan)

Normative for `packages/core/src/machine/**`. Companion to `architecture-plan.md` §1 and §8. Contracts: `machine/state.ts`, `machine/commands.ts`, `machine/events.ts`, `machine/effects.ts`, `machine/types.ts`, `authoring/compiled.ts`.

Conventions: `S` = current state, `def` = `CompiledFlow`, `rec(id)` = `S.steps[id]`, `now` = `env.now()`. Event bodies listed as `type{fields}`. "→ events" is what `decide` returns; `apply` and `plan` tables follow.

## 0. Global rules

- `decide` returns `[]` for anything it does not understand; it never throws. Unknown step ids / kinds → `command.rejected{code:'UNKNOWN_STEP'|'INVALID_COMMAND'}`.
- Terminal flow (`done|failed|cancelled`) rejects every command except `reset` (and `child` addressed to a still-running child): `command.rejected{code:'FLOW_TERMINAL'}`.
- `compensating` rejects `next/back/go/setInput/resetInput/send/run/runReady/retry` with `command.rejected{code:'FLOW_COMPENSATING'}`; accepts `cancel` (no-op → `[]`), `compensate` (only if `saga.failures` non-empty), `child`, `reset`.
- Flow not started (`status:'idle'`) rejects everything except `start`, `reset`, `setInput/resetInput` (drafts may be prepared before start).
- Every `call` effect gets `token = { step, runId: rec.runId, attempt?: rec.attempt, txId?: S.nav.txId }`. On `res.ok/res.err`, `decide` first checks the token against current state; mismatch → `[result.ignored{reason:'stale'}]`. Unknown step → `result.ignored{reason:'unknown-step'}`.
- `apply` recomputes `S.active` (all `status==='active'`), `S.status` (see §5) and `S.updatedAt = event.at` after every event; `S.seq = event.seq`.

## 1. Navigation pipeline (`next` / `go` / `back` / `start` / auto-advance)

Transaction id `txId = env.id('tx')`. Phases advance only via effect results. `S.nav` holds `{ phase, txId, from, to, cause, direction }`.

### 1.1 `decide` on commands

| Command | Preconditions (else → event) | → events |
|---|---|---|
| `start` | status `idle` (else `command.rejected{FLOW_TERMINAL / INVALID_COMMAND}`) | `flow.started{start: def.start[0]}`, then for each `id` in `def.start`: `step.arrived{step:id, from:null}`; then **schedule** (§3) |
| `next` | `S.nav.phase==='idle'` (else `transition.rejected{nav-busy}`); `S.current !== null` (else `no-target`… reason `not-active`); `rec(current).kind==='view'` | `transition.started{txId, from: current, cause:'next'}`, `transition.phase{parsingInput}` |
| `go{step}` | phase idle; step exists & kind view (`not-a-view`); target ≠ current; target reachable: `ready(target)` (§3.1) **or** `S.history.includes(target)` (`not-reachable`) | if `S.current` is a view and `direction` forward: same as `next` but with `to` fixed: `transition.started{txId, from, to: step, cause:'go'}`, `transition.phase{parsingInput}`; if `S.current===null`: `transition.started{...}`, `transition.phase{canEnter}` |
| `back` | phase idle; `S.history` has a previous view ≠ current (`no-history`) | `transition.started{txId, from: current, to: prev, cause:'back'}`, `transition.phase{canEnter}` (skips parseInput/validate/canExit; direction 'back') |

`transition.rejected` also settles the promise: `plan` emits `settle{txId, outcome:'rejected'}` for it.

### 1.2 Phase machine (driven by `plan` + effect results)

`plan` reacts to `transition.phase{phase}` by emitting the corresponding effect. `decide` reacts to the result and emits the next phase or a rejection.

| Phase | Effect (`plan`) | On `res.ok` (`decide`) | On `res.err` / false |
|---|---|---|---|
| `parsingInput` (from is a view with `input` boundary; else skip to `validating`) | `call{hook:'parseInput', step: from}` (executor runs boundary over `rec.input`; value = parsed) | `step.validated{step, output}`, `transition.phase{validating}` | `step.validationFailed{step, issues}`, `transition.rejected{reason:'validation', issues}` |
| `validating` (if hook `validate` exists else skip) | `call{hook:'validate', step: from}` (args.input = parsed output) | if value is `Issue[]` non-empty → same as failure; else `transition.phase{canExit}` | `step.validationFailed{issues: [{message}]}`, `transition.rejected{validation}` |
| `canExit` (if hook exists else skip) | `call{hook:'canExit', step: from, extra:{to}}` | `step.guardEvaluated{hook:'canExit', ok:true}`, `transition.phase{resolvingTarget}` | `step.guardEvaluated{ok:false}`, `transition.rejected{guard-canExit}` |
| `resolvingTarget` | if `to` fixed (go/back) → skip; if `from.next.kind==='dynamic'` → `call{hook:'next', step: from, extra:{output}}`; static → no effect, `decide` continues synchronously (§1.3) | value → `NextRef` normalized to `string[]` (null/[] → `transition.rejected{no-target}`); unknown id → `transition.failed`; else `transition.phase{canEnter}` with `to = targets` | `transition.failed{txId, step, error}` |
| `canEnter` | for **each** target with `canEnter` hook: `call{hook:'canEnter', step: target, extra:{from}}` (all emitted at once; `decide` collects) | when all targets answered: all ok → `transition.phase{exiting}`; any false → `step.guardEvaluated{ok:false}` + `transition.rejected{guard-canEnter, step}` | as false |
| `exiting` (if `from` has `exit` hook else skip) | `call{hook:'exit', step: from, extra:{to, direction}}` | `transition.phase{entering}` | `transition.failed` (from stays active; nav→idle) |
| `entering` | for each target: `call{hook:'enter', step: target, extra:{from}}` if hook exists | when all answered → **commit** (§1.3) | `transition.failed{step: target}` — targets not entered; from stays active |

`decide` implements the "skip" arrows itself: when a phase has no work it emits the next `transition.phase` in the same batch (so a fully-static, hookless `next()` produces one batch: started → phases → committed).

Multi-target `canEnter`/`enter`: `plan` emits one `call` per target; `decide` keeps progress in `S.nav` via `pending: string[]` (add field `pendingSteps?: readonly string[]` to `NavState`).

### 1.3 Commit

On completing `entering` (or immediately in `resolvingTarget` when nothing is left to do):

```
step.exited{step: from, to: targets[0], direction}          (only if from is a view; forward: from → done; back: from → idle)
for each target: step.arrived{step: target, from}
transition.committed{txId, from, to: targets[0], cause, direction}
```
`apply` on `transition.committed`: `nav → {phase:'idle'}`, `history` push `to` if `to` is a view (for back: pop back to it), `current` = first view among targets that became active (see §3.2), else null.

Then **schedule** (§3): arrived steps with satisfied deps enter.

`plan` on `transition.committed` → `settle{txId, outcome:'ok', value:{from,to}}`, plus `persist{reason:'change'}` (the interpreter coalesces persist effects).

### 1.4 Auto-advance (non-view completion)

When a `task/decision/wait/flow` step becomes `done` (`step.done`), `decide` continues in the same batch: resolve its `next` (static → arrive targets; dynamic → `call{hook:'next'}` then arrive) with `cause:'auto'` using a lightweight transaction (`transition.started{cause:'auto'}` → `canEnter` for targets → `step.arrived`… → `transition.committed`). Guard the hop counter: `S.nav.hops` (add `hops?: number` to `NavState`) resets on user commands; > 1000 → `flow.failed{code:'AUTO_ADVANCE_LOOP'}`.

## 2. Step entry / kinds

`enter(step)` (internal helper used by `apply` on `step.entered`): `status:'active'`, `runId+1`, `attempt:0`, clear `error/issues/output`, `pendingActivation:false`, `enteredAt: now`, `visitedCount+1`. Views keep `input`; on first entry with `def.initial` and no `input`, `apply` seeds `input = initial`.

`plan` on `step.entered` by kind:

| Kind | Effects |
|---|---|
| view | none (waits for cursor). If a view was arrived + ready and `S.current===null` and it is the only ready view → `decide` (cursor rule §8.3) emits `transition.committed{cause:'auto'}` — implemented inside schedule. |
| task | `step.runStarted{attempt:1, runId, idempotencyKey: `${instanceId}:${step}:${runId}`}` is emitted by `decide` in the same batch as `step.entered`; `plan` on `step.runStarted` → `call{hook:'run', step, timeoutMs, extra:{attempt}}` |
| decision | `call{hook:'next', step}` (its result is both output and target: `step.done{output: targets}` then arrive) |
| wait | drain inbox (§4.2); if nothing completed it and `waitTimeout` → `timer.scheduled{timerId, at: now+afterMs, purpose:'waitTimeout'}` → `plan`: `timer.set{fire:{type:'timer.fired', timerId}}` |
| flow | `call{hook:'childContext', step}` → on ok: `child.started{step, path}` + `plan`: `child.create{step, context: value}`; on err: `step.failed{kind:'hook'}` |
| final | if `finalOutput` hook: `call{hook:'finalOutput'}` → ok: `step.done{output}` + `flow.done{output}`; no hook: `step.done` + `flow.done` directly. `flow.done` → `apply` cancels other actives (`step.cancelled{reason:'flow-done'}` events are emitted by `decide` in the same batch, before `flow.done`) |

`enter` hooks: run during the `entering` phase (§1.2) for cursor transitions; for scheduler entries (§3), `decide` emits `step.entered` and `plan` emits `call{hook:'enter'}` **before** kind-specific effects only if the hook exists — to keep one rule: **kind-specific work starts only after `enter` resolves**. Model this with a per-step sub-phase: `S.steps[id].entering: true` (add optional field) → `res.ok(enter)` → `decide` emits the kind-specific start events (`step.runStarted`, timer, child…). If `enter` fails → `step.failed{kind:'hook'}`.

## 3. Scheduling (arrival, gating, readiness)

### 3.1 Readiness

```
depsSatisfied(id) = !dependsOn || (all: every dep in done|skipped) || (any: some dep in done|skipped)
ready(id)         = rec.pendingActivation && rec.status !== 'active' && depsSatisfied(id)
```
Selectors live in `selectors.ts` (pure, memoized per `S.seq`); `decide` uses them.

### 3.2 `schedule` (called by `decide` after any batch that changed a step status or arrival; implemented as a helper that appends events)

1. Candidates = steps with `ready(id)` in ascending `arrivedSeq`.
2. Non-view candidates: enter them (`step.entered`), tasks bounded by `concurrency` (count of tasks currently `active`) — extra ready tasks stay pending.
3. Views: never entered by the scheduler unless the cursor rule applies: if `S.current === null` and exactly one view is ready → enter it and emit `transition.committed{cause:'auto', from:null, to:id}` (history push). Views arrived via a cursor transition are entered by §1.3 directly (they are the `to`).
4. `autoRun:'manual'`: step 2 only runs on `runReady` / `run{step}` commands.

`decide` on `run{step}`: step must be a ready task (else `command.rejected{NOT_A_TASK / not ready}`), enter it regardless of concurrency budget. `runReady`: run step 2 once.

Every `step.done` / `step.skipped` / `step.failed` / `step.cancelled` batch ends with `schedule` (deps may now be satisfied).

## 4. Tasks, waits, decisions

### 4.1 Task results

| Message | → events |
|---|---|
| `res.ok(run)` (token ok) | if `output` boundary configured the executor already parsed it (err on failure). `step.runSucceeded{attempt, output}`, `step.done{output}` (+ push `saga.stack` if step has `compensate` — done in `apply` on `step.done`), then auto-advance §1.4 |
| `res.err(run)` | `attempts` allowed = `retry.attempts ?? def.policies.retry?.attempts ?? 0`. If `attempt <= allowed` and not cancelled: `step.runFailed{attempt, error, willRetry:true, timedOut}`, `step.retryScheduled{attempt+1, at: now+backoff(attempt), timerId}` (`apply` sets `retryAt`; `plan` → `timer.set{fire: {type:'timer.fired', timerId}}`). Else `step.runFailed{willRetry:false}`, `step.failed{kind: timedOut?'timeout':'run'}` → failure policy §5.1 |
| `timer.fired{timerId}` for a retry timer | `timer.fired`, `step.runStarted{attempt+1}` (token uses new attempt) |
| `retry{step}` command | step must be `failed` task: `step.entered`… no: keep runId, `attempt:0` → `step.runStarted{attempt:1}` (clear error) — emit `step.runStarted` only |
| `cancel{reason}` command | if any task active → set `S.cancelRequested` (add optional field), abort via `plan`: `call`? No: cancellation is `plan` → the interpreter aborts in-flight `run` effects for `step.cancelled` events. `decide`: for each active task `step.cancelled{reason}`; then if `onFailure==='compensate'` and stack non-empty → start compensation (§5.2) with `outcome:'cancelled'`; else `flow.cancelled{reason}` |

Backoff: `backoff` number → fixed ms; `'exponential'` → `min(200 * 2^(attempt-1), maxBackoffMs ?? 30_000)`; function → `fn(attempt)`.

### 4.2 Waits and external events

`decide` on `send{event, payload}` (v0.1 rules; **§10.1 supersedes step 2** — since v0.2 every kind may listen, plus flow-level handlers and correlation):
1. `inboxId = env.id('evt')`; `event.received{event, payload, correlationId, inboxId}`.
2. Targets = active `wait` steps whose `def.hooks.on[event]` exists (in `S.active` order).
3. If targets non-empty: for each `event.delivered{event, to, inboxId}` → `plan` emits `call{hook:'on', step: to, extra:{event, payload, inboxId}}` per target.
4. Else if `policies.unmatchedEvents.buffer`: `event.buffered{event, inboxId, expiresAt: now+ttlMs}` (apply pushes to `S.inbox`) + `timer.scheduled{timerId:'inbox:'+inboxId, at: expiresAt, purpose:'inboxTtl'}`; else `event.dropped{event, reason:'no-listener'}`.

`decide` on `sendRejected{event, issues}` → `event.rejected{event, issues}`.

`res.ok(on)` (token ok; extra carries `inboxId`): value `{ next?, keep?, done? } | void`. If `keep === true` → nothing (stay waiting). Else `step.done{output: { event, payload }}` (+ if `next` given: override target for auto-advance §1.4). Timer for this wait cleared: `timer.cleared` (apply removes; plan → `timer.clear`).
`res.err(on)` → `step.failed{kind:'hook'}`.

On `step.entered` for a wait: `decide` drains inbox — for each buffered entry (FIFO) whose event has a handler on this step: `event.delivered{to: step, inboxId}` (apply removes from inbox; `timer.cleared` for its TTL) — deliver **only the first matching** entry per entering wait? No: deliver all matching entries in order; the first that resolves the wait wins (later results → `result.ignored` because the step is no longer active/token mismatch). Simpler and deterministic: deliver **one** (oldest matching) entry; if the handler returns `keep`, the next drain delivers the next. Choose the simple rule and document it.

`timer.fired` for `waitTimeout` timer of an active wait: `timer.fired`, `step.done{output: { event: '__timeout__' }}` hmm — better: `step.skipped`? No: emit `step.done{output:{ event:'timeout' }}` and set the auto-advance target to `waitTimeout.next` (`decide` passes the override in the same batch). Record `wait.timedOut{step}`? Use `step.done` with output `{ event: 'timeout' }` and `transition.started{cause:'auto'}` toward `waitTimeout.next`.

`timer.fired` for `inboxTtl` → `event.expired{event, inboxId}` (apply removes entry).

### 4.3 Decision

`step.entered(decision)` → after `enter` (if any) `plan` emits `call{hook:'next'}`; `res.ok` → `step.done{output: targets}` + auto-advance to `targets`; `res.err` → `step.failed{kind:'hook'}`.

## 5. Flow status, failure policy, compensation

### 5.1 Status derivation (in `apply`, after each event)

```
if flow.done seen            → 'done'
else if flow.compensated     → outcome ('failed' | 'cancelled')
else if flow.cancelled       → 'cancelled'
else if flow.failed          → 'failed'
else if flow.compensating    → 'compensating'
else if any active task or decision or flow with running child → 'running'
else if any active view/wait  → 'waiting'
else if started              → 'waiting'   (e.g. everything pending on deps that can never be satisfied — explain() reports)
else                         → 'idle'
```
`apply` emits nothing; `S.status` is a stored field recomputed by this rule (keep the rule in one function `deriveStatus`).

### 5.2 Failure policy

On `step.failed{step}` (task exhausted, hook error, child failed):
- `onFailure:'halt'`: `flow.failed{step, error, code:'STEP_FAILED'}`; other active steps keep running to completion? **No** — halt = stop scheduling; running tasks continue and settle (their results are applied); nothing new enters. Flow status `failed`; `retry(step)` is allowed on failed tasks and, if it succeeds, the flow **resumes** (status recomputed → back to running/waiting; add rule: `flow.failed` is not sticky when a later `step.done` for the failed step arrives — implement as: `S.failedStep`; status 'failed' while `rec(failedStep).status==='failed'`).
- `onFailure:'compensate'`: `flow.compensating{reason, plan: reverse stack}` → phase 1: `apply` sets status; `decide` cancels running tasks (`step.cancelled` for each active task; interpreter aborts); waits for outstanding tokens: track `S.saga.settling: string[]` (add field) — steps whose `run` is in flight. When empty (immediately if none) → phase 2.
- Phase 2 (`decide`, one at a time): pop next entry from `saga.stack` (highest seq first) not yet compensated → `step.compensationStarted{step}` → `plan`: `call{hook:'compensate', step, extra:{output, reason}}` (flow steps: `child.send{command:{type:'compensate'}}` and wait for `res.child` with summary status `failed|cancelled`… treat child compensation completion as `res.ok(compensate)`). `res.ok` → `step.compensated{step}`; `res.err` → `step.compensationFailed{step, error}` (push `saga.failures`). Continue until stack exhausted → `flow.compensated{failures, outcome}` where outcome = 'cancelled' if triggered by `cancel`, else 'failed'.
- `compensate{from?}` command: if status is `failed|cancelled` after a compensated flow with failures → re-run phase 2 for `failures` (or only `from`). If status running/waiting → behaves like `cancel` with reason.

## 6. Data commands

| Command | Preconditions | → events / apply |
|---|---|---|
| `setInput{step, patch}` | step is a view; step is not the `from` of an in-flight transition (`nav-busy`); flow not terminal | `input.changed{step, patch}` → `apply`: `input = { ...input, ...patch }` (shallow, patch must be an object; non-object → replace), clear `issues` |
| `resetInput{step}` | view | `input.changed{step, patch: initial ?? undefined, reset:true}` → `input = initial` |
| hook `update(patch)` (from executor) | delivered as internal message? **No**: `update()` inside a hook enqueues `{ type:'context.patch', patch, by: step }` — add this to `Message` as `{ type: 'context.patch'; patch: Record<string,unknown>; by?: string }` (internal, not a public Command) | `context.changed{patch, by}` → `context = { ...context, ...patch }` |

## 7. Nested flows

- `child.create{step, context}` (interpreter) → creates a child interpreter; the bridge forwards child events to the parent `observe()` and sends `res.child{step, summary, done?, failed?}` on child status changes.
- `decide` on `res.child`: `child.summary{step, summary}`; if `done` → `call{hook:'childOutput'}` if hook else `step.done{output: done.output}` (+ auto-advance); if `failed` → `step.failed{kind:'child'}`.
- `command child{path, command}` → `plan`: `child.send{step: path[0], command: path.length>1 ? {type:'child', path: path.slice(1), command} : command}`; `decide` emits nothing else (results flow back via `res.child`).
- Compensation of a flow step: `plan` emits `child.send{compensate}` instead of `call{compensate}`; completion arrives as `res.child` with summary status `cancelled|failed` → treat as `res.ok(compensate)`.

## 8. Reset & resume

- `reset` → `flow.reset` → `apply` returns `initialState` (same instanceId, epoch+1? no — epoch is for resume; reset keeps epoch), plus `plan`: `timer.clear` for all timers, `child.dispose` for all children.
- Resume (façade): validate snapshot → state = snapshot.state with `epoch+1`; `decide` on internal message `{ type:'resume' }` (add to `Message`) → per §8.8 matrix: `flow.resumed{fromSeq, interrupted}`; `transition.rejected{resumed}` if nav in flight; `step.failed{kind:'interrupted'}` for running tasks; drain inbox for active waits; `plan` re-arms every `S.timers` entry (`timer.set`; overdue → fire immediately by setting `at = now`).

## 9. Testing requirements (machine)

Pure tests, no timers/promises: build `CompiledFlow` literals with tiny hooks; call `decide/apply/plan` directly; assert event sequences and effects. Required suites: nav pipeline (each veto point), static+dynamic next, back, go reachability, fan-out atomicity, scheduler ordering + concurrency budget, retry/backoff schedule, timeout → failed, halt vs compensate, compensation order + partial failure, wait routing (broadcast, buffer, TTL, drain on enter, timeout), decision, final cancels actives, deriveStatus table, token staleness, terminal/compensating rejections, `replay(log)==state` property on 3 fixture flows, resume matrix (§8). v0.2 (§10): `tests/machine/{on-handlers,when-skip,invalidate,idempotent-maperror}.test.ts` (+ a fourth `replay` fixture) and `tests/wizard/e2e/v2.e2e.test.ts` with the real runtime.

## 10. v0.2 additions (plan §9) — normative

Everything below is additive to §0–§9. New events, effects, state fields and commands are listed where they appear; `apply` stays a total fold and `replay(log) == state` holds for every fixture (`tests/machine/idempotent-maperror.test.ts`).

### 10.1 `on[event]` on every kind, flow-level `on`, correlation (plan §9.1)

**Routing** (`decide` on `send{event, payload, correlationId?}`, `wait.ts:routeEvent`):

1. `event.received{event, payload, inboxId, correlationId?}` — `correlationId` = the caller's, else `def.correlate[event](payload)` when it returns a string.
2. **Correlation**: if `def.correlate[event]` exists AND `S.correlationId` is defined AND (`correlate(payload) !== S.correlationId` or the extractor threw) → `event.dropped{reason:'correlation'}`, stop (no delivery, no buffering). No `correlate` entry, no `S.correlationId`, or an extractor returning `undefined` = no filtering. `S.correlationId` comes from `InitialStateOptions.correlationId` (`createWizardRuntime({ correlationId })`), survives `reset`, is persisted, and children created by the instance inherit it.
3. **Step targets** = every ACTIVE step (any kind, `entering !== true`) whose `def.hooks.on[event]` exists — a **view listens only while `S.nav.phase === 'idle'`**. For each: `event.delivered{event, to, inboxId, payload}` → `plan`: `call{hook:'on', step: to, extra:{event, payload, inboxId}}` (unchanged shape).
4. **Flow-level**: if `def.on[event]` exists → `event.flowDelivered{event, inboxId, payload}` (after the step deliveries, same batch) → `plan`: `call{hook:'flowOn', step:'', token:{step:'', runId:0}, extra:{event, payload, inboxId}}`. The executor and `decide` route on `hook === 'flowOn'` before looking at `step` (`''` is never treated as a step id). The flow-level handler sees every accepted event exactly once, at send time (drains never re-run it).
5. **Buffering**: if no step target and (no flow handler OR a nav-busy view would have handled it): `event.buffered` + `inboxTtl` timer per `unmatchedEvents` — **always** buffered (regardless of `unmatchedEvents.buffer`) when a nav-busy view is a would-be listener; else `event.dropped{reason:'no-listener'}`. Step targets or a flow-level handler alone → nothing buffered.

**Drains** (`drainInbox`, one oldest matching entry per drain, unchanged rule): a non-view step drains when its kind starts (`startKind`, after `step.runStarted` / decision-next call / …) and after every handler result; **the current view drains in `onNavIdle`** (after a commit/rejection/failure of any transaction, and on resume) and after every handler result that did not start a transition. Waits keep §4.2.

**Handler results** (`res.ok(on)`, `wait.ts:onHandlerResult`), by kind:

| Kind | Honoured | Else |
|---|---|---|
| wait | `void \| {keep} \| {next} \| {done} \| {fail}` — §4.2 unchanged | — |
| view | `void`; `{next}` → **event transition** (below); unknown target → `step.failed{kind:'hook', code:UNKNOWN_STEP}` | `{next}` while `nav` busy → `event.handlerResultIgnored{step, event, reason:'nav-busy'}`; `keep/done/fail` → `…{reason:'kind'}` |
| task / decision / flow / final | `void` (`update()` only) | any of `next/keep/done/fail` → `event.handlerResultIgnored{reason:'kind'}` |

`res.err(on)`: wait → `step.failed{kind:'hook'}` (v0.1); every other kind → `event.handlerFailed{step, event, error}`, the step continues. Flow-level: `res.ok` `{cancel: reason}` → same as `cancel{reason}` (compensation policy applies); `void` → nothing; `res.err` → `event.handlerFailed{event, error}` (no `step`); a flow-level result once the flow is idle/terminal/compensating → `result.ignored{stale}`.

**Event transition** (`nav.ts:startEventTransition`): `transition.started{txId, from: view, to: next, cause:'event'}` → phases `resolvingTarget` (targets fixed) → `canEnter` (targets) → `exiting` (`exit` of the view) → `entering` (`enter` of targets) → commit (§1.3: `step.exited{direction:'forward'}`, arrivals, cursor, `transition.committed{cause:'event'}`). No `parseInput` / `validate` / `canExit`; the view's `output` is not updated. `hops` resets (an external cause). `NavCause` gains `'event'`.

`SendResult`: `{ok:true, delivered:[step ids], buffered}` — a flow-level delivery alone is `ok:true, delivered:[]`; a correlation drop is `{ok:false, reason:'dropped', code:'NOT_ACTIVE', message:'correlation'}`.

`runtime.attach(source)`: calls `source(runtime.send)`, keeps the returned disposer, runs it on `dispose()` (or when the returned function is called; idempotent); throws `DISPOSED` afterwards.

### 10.2 `when` + `skip` (plan §9.2)

State: `StepRecord.when?: 'pending' | 'passed'`, `StepRecord.skipReason?`, `NavState.cursorHint?`. Selectors: `eligible(id) = pendingActivation && status !== 'active' && depsSatisfied(id)` (§3.1 readiness ignoring `when`), `awaitingWhen(id) = def.hooks.when !== undefined && rec.when !== 'passed'`, **`ready(id) = eligible(id) && !awaitingWhen(id)`** (every v0.1 use of `ready` — scheduler, cursor rule, `go` reachability, `run{step}`, `available`, `explain` — now excludes steps whose `when` has not passed).

`schedule` (§3.2) gains step 0: for every eligible step (any kind, any `autoRun`) with a `when` hook and `rec.when === undefined` → `step.whenStarted{step}` (`apply`: `when:'pending'`; `plan`: `call{hook:'when', step, token:{step, runId}}`; the token is the record's current `runId`, so a later entry/skip makes the result stale). Then steps 1–3 over `readySteps` as before.

`res.ok(when)` (valid only while `status !== 'active' && when === 'pending' && pendingActivation`): value `false` → `step.whenEvaluated{ok:false}` + **skip** (below, `reason:'when'`); anything else → `step.whenEvaluated{ok:true}` (`apply`: `when:'passed'`) + `schedule`. `res.err(when)` → `step.failed{kind:'hook'}` + failure policy. `when` is cleared by `step.entered`, `step.skipped`, `step.invalidated`, `step.cancelled`, `step.failed`.

**Cursor rule** (§3.2.3, `cursorRule`): waits while any eligible view awaits `when`; then exactly one ready view → move; several → the one equal to `nav.cursorHint`, else none. `cursorHint` is set by `apply(transition.committed)` when the transaction entered no view but its cursor target (§8.3 first-view rule) awaits `when`; it is dropped when a cursor is set or the hinted view enters/skips/invalidates/fails. Consequences: `next()` toward a view with an unevaluated `when` commits `{to: view}` without entering it; the entry follows as a second `transition.committed{cause:'auto', from:null}` once the predicate passes (or the view is skipped and the cursor moves on). Explicit `go`/`back` to a **visited** view enters it when eligible — explicit intent overrides `when` (a ready, never-visited view whose `when` is pending is `not-reachable`).

**Skip** (`scheduler.ts:skipStep`): `step.skipped{step, reason:'when'|'command'}` (`apply`: status `skipped`, `skipReason`, clears `output/error/issues/retryAt/deadline/idempotencyKey/arrivedSeq/when`, keeps `input` and `previousOutput`, `pendingActivation:false`; when `nav` is busy the continuation is queued in `nav.deferred` like `step.done`), then **continuation** = the auto-advance transaction of §1.4 from the skipped step (`transition.started{from: step, cause:'auto'}`): static `next` → targets arrived; dynamic `next` (including a skipped **decision**) → `call{hook:'next'}` first (`plan` on `resolvingTarget` now also emits it for a skipped decision); `next: none` → nothing. A skipped `from` never runs `exit` (it never entered); no `step.exited`. Then `schedule`. Skipped counts as complete for `dependsOn` and for `progress`; the cursor never enters a skipped view. A skipped step re-arrived later (loops) asks `when` again.

Command `skip{step, reason?}` (`decide:cmdSkip`; gate as any nav/run command): unknown → `command.rejected{UNKNOWN_STEP}`; final → `{INVALID_COMMAND, 'final-step'}`; active step: if it is `nav.from` of an in-flight transaction → `{NAV_BUSY}`, else non-view kinds are cancelled first (`step.cancelled{reason: cmd.reason ?? 'skip'}` — run aborted by the interpreter, wait timers cleared, child flow sent `cancel`), a current view just leaves (no `exit`, no validation); eligible-but-idle (ready, budget-limited, `when` pending — its result becomes stale) → skipped; anything else → `{NOT_ACTIVE, 'not-ready' | 'not-skippable:<status>'}`. Then `step.skipped{reason:'command'}` + continuation.

`explain` reasons: `when-pending`, `skipped:<reason>`; `phase()` = `'blocked'` while `when` is unresolved; `run{step}` on such a task → `command.rejected{NOT_ACTIVE, 'when-pending'}`.

### 10.3 `invalidate` (plan §9.3)

Command `invalidate{step, cascade?}` (default `cascade: true`). Gate: like other commands, **plus** allowed in a halted flow (`isRecoverableFailure`, like `retry`). `decide:cmdInvalidate`: unknown → `UNKNOWN_STEP`; `status === 'active'` → `command.rejected{INVALID_COMMAND, 'current-view' | 'active'}`; status not in `done|failed|skipped` → `{INVALID_COMMAND, 'not-invalidatable:<status>'}`. Else `step.invalidated{step, cascade, cause:'command'}`; with `cascade`, for every transitive `dependsOn` dependent (declaration order): active → `step.cancelled{reason:'invalidated'}` first (run aborted / child cancelled / timers cleared — the current view included), then, when done/failed/skipped/just-cancelled → `step.invalidated{step, cascade:true, cause:'cascade'}`; pending/idle dependents are untouched (they simply become blocked). Then `schedule`.

`apply(step.invalidated)`: status `idle`, `pendingActivation:false`, `previousOutput` = the old `output` (absent when there was none), clears `output/error/issues/skipReason/retryAt/deadline/idempotencyKey/arrivedSeq/entering/enterDone/when/child`; keeps `input` (a view's draft), `runId`, `visitedCount`, `history` membership (so `back`/`go` can revisit it), guards. **Saga stack entries stay** (the completion happened; a later re-run pushes another). `deriveStatus`: on `step.invalidated` the "failed stays failed" rule is bypassed — invalidating the failed step of a halted flow recomputes the status (→ `waiting`/`running`), which un-halts it. Never automatic (§8.4 stands): routing through the invalidated step again (`next`/`go`/`back`) is the author's/user's job. On resume `previousOutput` is re-parsed by the step's boundary like `output` (and is a revivable location for the persist-time JSON check).

### 10.4 Idempotent tasks (plan §9.4)

`CompiledStep.idempotent`, `hooks.idempotencyKey`. `startKind(task)`: with a key hook → `step.idempotencyKeyRequested{step, runId}` (`plan`: `call{hook:'idempotencyKey', step, token:{step, runId}, extra:{attempt:1}}` — args = the run's args) → `res.ok` (string) → `step.runStarted{attempt:1, runId, idempotencyKey: value}` (non-string → default key; `res.err` → `step.failed{kind:'hook'}`); without → `step.runStarted` with the default `${instanceId}:${step}:${runId}` as before. Retries (`timer.fired` retry, `retry` command) and every `HookArgs.idempotencyKey` reuse the stored `rec.idempotencyKey`. On resume, a task still awaiting its key (`attempt === 0`, not entering) gets the key call re-issued (`planResume`).

Resume (§8.8 row "task active (running)"): `interrupted` = tasks with a run in flight (listed on `flow.resumed.interrupted` as before); for each, `def.idempotent === true` → `step.runStarted{attempt: rec.attempt, runId, idempotencyKey: rec.idempotencyKey, resumed:true}` (the run is re-issued, same key, `attempt` unchanged) — else `step.failed{kind:'interrupted'}` (v0.1). A task whose `mapError` call was in flight is indistinguishable from a running one at resume time and follows the same row.

### 10.5 Snapshot migration (façade, plan §9.5)

`resumeWizardRuntime(def, snapshot, { migrate })` / `…Async`: when `snapshot.flow.name === def.name && snapshot.flow.version !== def.version` (and only then), `migrate(snapshot, { name, version })` runs first; its result is validated like any snapshot (its `flow.version` must equal `def.version` — no auto-bump). A name mismatch never migrates. Sync door: a thenable result → `SNAPSHOT_INCOMPATIBLE` reason `migrate: returned a promise … (use resumeWizardAsync)`; a throw → `migrate: threw (…)`. Async door awaits it (rejection → the same reason).

### 10.6 Selectors + runtime conveniences (plan §9.6)

`progress(state, def): { done, total, ratio }` — `total` = non-final steps, `done` = status `done|skipped`, `ratio = done/total` (0 when `total === 0`), **1 once the flow is `done`**; memoized per state; `ChildSummary.progress` = its `ratio`. `readyOrCurrentViews(def, state)` = views that are current or ready, declaration order. Runtime: `progress()`, `readyViews()`, `skip(step, reason?)`, `invalidate(step, { cascade? })`, `attach(source)`, create option `correlationId`, resume option `migrate`. `parseCommand`/`decodeCommand`: shapes `skip{step!, reason?}`, `invalidate{step!, cascade?: boolean}` (ids checked against the flow when given).

### 10.7 `mapError` (plan §9.7)

`res.err(run)` (token ok, run in flight) with `def.hooks.mapError`: `step.mapErrorStarted{step, attempt, error, timedOut?, syncViolation?}` (no state change; `plan`: `call{hook:'mapError', step, token:{step, runId, attempt}, extra:{error, attempt, timedOut?, syncViolation?}}` — the interpreter substitutes the RAW thrown value for `args.error` when it still has it, else the serialized form). `res.*(mapError)` (valid while the run is in flight): `res.ok` → `data = value`, `res.err` (mapper threw) → no `data`; then the v0.1 §4.1 outcome with `data` on `step.runFailed{…, data?}` (each attempt) and, when out of retries, on `step.failed{…, data?}`; `apply` stores it as `StepError.data` (`toStepError`). Without `mapError` the events are unchanged. `data` must be JSON-safe: the persist-time walk (`firstNonJson`) rejects a snapshot whose `state.steps.<id>.error.data` is not (`SNAPSHOT_NOT_SERIALIZABLE`, `persist.failed{location}`), and `validateSnapshot` rejects it on resume.

### 10.8 Contract summary (additive)

- `commands.ts`: `HookName` += `'when' | 'mapError' | 'idempotencyKey' | 'flowOn'`.
- `events.ts`: `step.whenStarted{step}`, `step.whenEvaluated{step, ok}`, `step.idempotencyKeyRequested{step, runId}`, `step.mapErrorStarted{step, attempt, error, timedOut?, syncViolation?}`, `event.flowDelivered{event, inboxId, payload?}`, `event.handlerResultIgnored{step, event, reason:'kind'|'nav-busy'}`, `event.handlerFailed{step?, event, error}`; fields `step.runFailed.data?`, `step.failed.data?`; `event.dropped.reason` gains `'correlation'`.
- `state.ts`: `StepRecord.when?: 'pending'|'passed'`, `NavState.cursorHint?: string` (plus the pre-existing v0.2 fields `previousOutput`, `skipReason`, `correlationId`, `StepError.data`).
- `types.ts`: `InitialStateOptions.correlationId?`.
- `selectors.ts` / `machine/index.ts`: `eligible`, `eligibleSteps`, `awaitingWhen`, `viewsAwaitingWhen`, `readyOrCurrentViews`, `progress(state, def): Progress` (replaces the v0.1 `progress(state): number`), type `Progress`.
- Executor: `flowOn` invocation, raw-error hand-off for `mapError`, `HookArgs.idempotencyKey = rec.idempotencyKey ?? default`.
- Runtime: `WizardRuntimeOptions.correlationId?`, `ResumeWizardRuntimeOptions.migrate?` (`SnapshotMigration`), methods `skip/invalidate/attach/progress/readyViews`.
