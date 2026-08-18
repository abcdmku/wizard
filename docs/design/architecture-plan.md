# OpenWizard — architecture & implementation plan

## Context

- Repo `wizard` (branch `v3`) has an **empty working tree**. History holds:
  - v1 monorepo at `HEAD~1` (`@wizard/core`, `@wizard/react`, `dag-core`, `dag-react`, Nextra/Monaco docs, 8 examples) — a linear/branching form-wizard library on `@tanstack/store`.
  - `HEAD` ("v2 init") = v3 design docs + type contracts (`v3-*.md`, `core-contracts.ts`, `react-contracts.ts`, `examples/modes/*`), deleted (unstaged) in the working tree.
- **The brief:** OpenWizard — open-source, TypeScript-first, type-safe orchestrator for sync + async workflows; define *and* subscribe via TS; compose complex flows; integrate out-of-domain services; ingest external events with no contract via an *assert-at-boundary* pattern; isomorphic (backend + frontend, with client-safe projections of state/step status); every step has a lifecycle (simple → deeply nested); goal is deep understanding of large complex systems.
- **User direction mid-planning:** "v1 got bloated. I like the very deep type safety it had and the UI was great, but approach this with a clear mind." → clean-slate design; v1/v3 are reference only (lessons + proven type tricks). Keep: cast-free deep inference; the UI bar (Monaco landing, DAG visualizer) for later docs/devtools phases — the core must expose the data they need (static graph + event trace).

## Anti-bloat rules (binding for every phase)

1. One authoring path (`defineFlow` + pre-bound `s.view/task/wait/decision/flow/final`), one live object (`Wizard`), one wire door (`dispatch(Command)`).
2. Every exported symbol has: a test, a `.test-d.ts` assertion if generic, TSDoc `@public`, and a row in the generated export table.
3. No field in a type without a runtime consumer + test (v1 typed `weight`/`prerequisites`/`emit` and never implemented them).
4. Exactly one type extractor per concept (`InputOf`, `OutputOf`, `PayloadOf`, `Ctx`…). No positional generics on public functions.
5. Concept budget: 6 step kinds, ≤10 hooks per kind, ≤10 flow options, 8 stored step statuses.
6. Status axes are never collapsed into one string; derived axes live in selectors.

## v1/v3 lessons baked in

- `next: ['typo']` compiled in v1 → **id safety is Phase 0's gate**, not a later polish.
- Async guards had two sources of truth → guards are effects whose results are folded into state; selectors never call hooks.
- `back()` restored context wholesale → context is never auto-restored; inputs retained; explicit hooks.
- Type tests never ran (`expectTypeOf` without `--typecheck`, tests excluded from tsc) → `vitest --typecheck` on `*.test-d.ts` in CI from day one.
- Docs drift → generated export tables + `check-doc-imports` + API d.ts snapshot diff from day one.
- Library was minified, biome had no config, Nx was overhead → tsdown (no minify), `biome.json`, plain pnpm.

---

## 1. Architecture (decisions)

### 1.1 Layered core: pure machine + interpreter (event-sourced)

Three pure functions (no I/O, no timers, no promises) plus one single-threaded interpreter per wizard instance:

```ts
decide(def, state, msg: Command | EffectResult): DomainEvent[]   // intent → facts (or command.rejected)
apply (def, state, ev: DomainEvent): State                       // fold; also used by Mirror/replay/tests
plan  (def, state, ev: DomainEvent): Effect[]                    // side-effect *descriptions* (call hook, timer, child, persist, settle)
```

- Interpreter: one FIFO queue; `drain()` runs decide→apply→plan; sync hook results are pushed back onto the queue and processed in the same call stack; async results re-enter via `send()`. **Guarantee:** if every hook in a transition returns a non-thenable, state is committed and listeners notified before the public method returns (promise already resolved). `strict: 'sync'` option makes a thenable a `SyncViolationError`.
- Ordering: no re-entrant reduction; navigation commands while a transition is in flight → `command.rejected {reason:'nav-busy'}` (double-click never skips a step); `setInput`/`send`/`retry`/`cancel` are orthogonal and processed immediately; stale async results detected by `{txId, attempt}` tokens → `result.ignored`.
- Persistence is **snapshot-authoritative, log-advisory**: state is a fold of events but resume loads state directly; the log is a bounded ring (default 200) for trace/devtools. Replay is never on the hot path.
- Injectables: `{ clock, scheduler, ids }` for deterministic tests (`createTestScheduler().advance(ms)`).

Why (vs. mutable store + pipelines as in v1/v3): every change is a typed event with `causedBy` (the "deep understanding" requirement), Mirror = `apply` over projections, replay/time-travel free, sync/async is one code path, `decide/apply/plan` test with plain data. Cost: ~2–3 kB and a steeper contributor curve, hidden from users by the DSL.

### 1.2 No `mode`; kinds + policies

Behavior derives from step kinds and a small policy set. Presets are documentation, not code paths.

| Kind | Enters when | Completes when | Key hooks |
|---|---|---|---|
| `s.view` | cursor arrives (`next/go/back`) | user calls `next()` and the draft input parses through `input` + `validate` + `canExit` pass | `input` (boundary), `initial`, `validate`, `canEnter`, `canExit`, `enter`, `exit`, `next`, `expose` |
| `s.task` | cursor arrives (auto-run) | `run` resolves (optionally through `output` boundary) | `run`, `output?`, `retry`, `timeout`, `compensate`, `enter?`, `exit?`, `next`, `expose` |
| `s.wait` | cursor arrives | an `on[event]` handler resolves, or `timeout.after` fires | `on`, `timeout {after, next}`, `enter`, `exit`, `next` |
| `s.decision` | cursor arrives | `next(args)` returns a target | `next` (fn) |
| `s.flow(child, …)` | cursor arrives → child created | child reaches `final` | `context` (parent→child), `output?`, `exit`, `expose`, `next` |
| `s.final` | cursor arrives | immediately; wizard `done` | `output?` |

(`s` = the pre-bound `StepApi` handed to `steps: (s) => ({…})`; see §3.)

Flow options (all): `name`, `context` (value or boundary), `events` (boundaries), `start`, `onFailure: 'halt' | 'compensate'`, `retry` (default for tasks), `autoRun: 'ready' | 'manual'` (default `'ready'`), `concurrency` (default `Infinity`), `unmatchedEvents: { buffer: boolean; ttl: Duration }`. Runtime options: `context` (when the flow declares a boundary), `store/key/autoSave/redact`, `clock/scheduler/ids`, `strict: 'sync'`, `logSize`.

### 1.2b DAG semantics (edges vs. dependencies)

- `next` = **navigation edges** (where the cursor/arrival goes after a step completes). `dependsOn` = **data readiness** (AND-join; `{ any: [...] }` for OR-join). Both are ids checked at compile time.
- **Readiness rule:** if a step declares `dependsOn`, it becomes `ready` when the deps are `done|skipped` (no arrival needed). If it declares none, it becomes `ready` on arrival via a predecessor's `next` (or `start`). This makes pure wizards (`next` only), pure DAGs (`dependsOn` only) and hybrids one rule.
- **Auto-run:** ready `task/decision/wait/flow` steps start automatically (`autoRun:'ready'`) subject to `concurrency` (tasks only); `runReady()` schedules manually when `autoRun:'manual'`. Ready `view` steps never auto-complete: they wait for the cursor.
- **Cursor with fan-out:** `next: ['a','b']` from a view arrives at both; tasks among them run in parallel; the first view in `next` order becomes `current`, others stay `ready` (reachable via `go`). After every commit, if `current` is null and exactly one view is ready, the cursor auto-moves there (`transition.committed {cause:'auto'}`); if several are ready the cursor stays null and `explain()` lists candidates.
- **State:** `current: ViewId | null` (UI cursor) and `active: StepId[]` (every non-idle, non-terminal step) are both stored; wizard `status` (`idle|running|waiting|done|failed|compensating|cancelled`) is derived from active steps.
- **Invalidation:** when a done step's input/context-dependency changes, transitive `dependsOn` dependents are `step.invalidated` → `idle` (output moved to `lastOutput`, running ones cancelled) per `onUpstreamChange: 'invalidate' | 'keep'` (default invalidate for task/decision/wait/flow, keep for view). No auto-compensation on invalidate (documented).
- **Compensation across a DAG:** cancel running tasks first, then compensate in reverse completion (`seq`) order, best-effort.
- `inspect()` warns statically about unreachable steps, `next` targets whose deps cannot be satisfied along that path, and cycles.

Wizard methods (all sugar over `dispatch(Command)`): `next() back() go(viewId)` · `setInput(viewId, patch)` (shallow-merge draft; parsed on `next/go`) `resetInput(viewId)` `validate(viewId)` (live issues) · `send(event, unknown) → SendResult {ok, delivered:'handled'|'buffered'} | {ok:false, issues}` · `retry(taskId)` `cancel(reason?)` · `getSnapshot() subscribe() observe() log()` · `project(projection)` · `child(flowStepId)` · `save() dispose()`.

### 1.3 Data doors = boundaries (the "assert type bindings" pattern)

`Boundary<T> = StandardSchemaV1<unknown, T> | Checker<T>` where `Checker` is **branded** (plain functions are rejected — guard vs parse is ambiguous):
`boundary.parse(fn)`, `boundary.guard(fn)`, `boundary.assert(fn)`, `boundary.trusted<T>()` (no runtime check; grep-able escape hatch).

Exactly four doors, each with a declared boundary: (1) `context` at `createWizard`; (2) `setInput` → parsed by the view's `input` boundary on `next()/go()`; (3) `send(type, payload)` → `events[type]` boundary; (4) `resumeWizard(flow, unknown)` → every boundary re-run over the snapshot. Task `output` is an optional fifth check on values returning from out-of-domain services. Rejections are events (`event.rejected`, `step.validationFailed`) with Standard Schema `Issue[]`, never thrown from the reducer.

### 1.4 Step lifecycle (one statechart; kind decides which arrows exist)

Stored `status`: `idle | active | done | failed | skipped | cancelled | compensating | compensated` (8). Stored sub-state on the step record: `attempt`, `retryAt`, `deadline`, `input`, `output`, `lastOutput`, `issues`, `error: SerializedError & {kind:'validation'|'guard'|'run'|'compensate'|'interrupted'}`, `guards.{canEnter,canExit}: {ok, seq}`, `enteredAt/exitedAt`, `visitedCount`, `child` (summary/snapshot).

Derived (selectors, memoized per `state.seq`, never call hooks): `phase` for UIs (`blocked | ready | entering | validating | running | retrying | waiting | exiting`), `available`, `required`, `complete`, `visited`, `progress`, `explain(step)` reasons.

Transition pipeline for `next()` on a view: parse input → `validate` → `canExit` → resolve `next` → `canEnter(target)` → `exit` → `enter` → `transition.committed`. Non-view targets auto-run on entry; on `done` the machine auto-advances (`cause:'auto'`) until it lands on a view or final. `back()` = previous view in history (`canEnter(prev)`, `exit(current,{direction:'back'})`), context never restored, inputs kept, current → `idle` (visited stays true). `go(id)` = any view that is `ready` (deps satisfied / arrived) or previously visited, gated by `canEnter`; otherwise `WizardError('NOT_REACHABLE')` with `explain()` reasons. Failure: `retry {attempts, backoff}` with `retryAt` timer, `timeout` via `AbortSignal`, then `failed`; `onFailure:'compensate'` cancels running work and compensates in reverse completion order, best-effort, collecting `saga.failures`; `retry(step)` re-runs a failed task; `cancel(reason)` compensates if policy says so.

### 1.5 External events

`events: { 'payment.captured': z.object({...}) }` → `wizard.send('payment.captured', unknownBody)`: boundary → `event.received` or `event.rejected {issues}`; routed to the active `wait` step's `on['payment.captured']` (v0.2: `on` on any kind + flow-level `on`); handler may `update` context and/or return a target. **No listener → inbox buffer** (`event.buffered`, FIFO, TTL default 5 min, `event.expired`), drained when a matching wait step enters — solves the webhook-arrives-early race. `timeout: {after, next}` stores an absolute `deadline`; timers are state and re-armed on resume (fire immediately if past). Multi-instance correlation and `sources` adapters are v0.2 (host routes to the right wizard instance in v0.1).

### 1.6 Nesting

`s.flow(childFlow, { context: (args) => childCtxInput, output?, exit, expose, next })`. Child = its own interpreter/queue; `path = parentPath + '/' + stepId`; child events forwarded to the parent's `observe()` stream with `path`; parent stores `steps[id].child` (status/current/progress + full child snapshot for persistence). Commands cross the boundary as `{ type:'child', path, command }`; `wizard.child('fulfil')` returns a typed `Wizard<ChildFlow>` (server side; Mirror/React child support in v0.2). Compensating a `flow` step = compensating the child. Guards: `maxDepth` 8; a flow may not embed an ancestor (checked at child creation).

### 1.7 Client protocol (backend ↔ frontend)

- `Snapshot<F>` is JSON-serializable and versioned (`v`, `flow`, `flowVersion`, `seq`).
- `clientState(flow, { expose })` → `Projection<F, ClientState<F,E>>`: per step `{ kind, status, phase, attempt, issues, input?, output?, error?: {message, code} }` + `current`, `status`, picked `context` fields, `output?`. Defaults: view input + issues exposed; task/wait/flow outputs hidden unless `expose`. `SerializedError` never carries stacks. `defineProjection(flow, select)` is v0.2.
- `Command<F>` (JSON): `next | back | go | setInput | resetInput | send | retry | cancel | child`. Every `Wizard` method is sugar over `dispatch(cmd)`; servers allow-list commands after auth.
- `createMirror({ transport })` (client): read-only replica typed by the projection, same command sugar, `getSnapshot/subscribe`; **v0.1 update strategy = full projected snapshot on `seq` change** (event-stream/patch mirror later). `createLocalTransport(wizard, projection)` loopback for tests. No optimistic UI in v0.1.

### 1.8 Introspection

`observe(listener)` — event envelope `{ seq, at, causedBy, path, step?, type, data? }`; `log()` bounded ring; `inspect(flow)` static graph `{ nodes:{id,kind,path,label,hooks[]}, edges:{from,to,kind:'next'|'dependsOn'|'timeout'}, warnings }` (port of v1 `stepsToGraph`, minus probing); `explain(wizard, step)` → `{ status, phase, reasons: ['deps-unmet:pay', 'guard-false:canEnter', …], candidates }` (v0.1, M2); `toMermaid` v0.2; devtools panel v0.3. These three (`inspect`, `observe`, `explain`) are exactly what the future DAG visualizer/devtools consume.

---

## 2. Public API surface (v0.1) — target shape

(§2 = the API the type spike must make cast-free; final signatures land in `packages/core/src/index.ts` and `api/core.d.ts`.)

```ts
// @openwizard/core
export { defineFlow, createModule, boundary, createWizard, resumeWizard, createMemoryStore,
         clientState, createMirror, createLocalTransport, inspect, WizardError }
export type { Flow, Wizard, Snapshot, StepState, WizardEvent, Command, Boundary, Store, Transport,
              Projection, ClientState, Mirror, FlowGraph, RetryPolicy, Duration, Issue, SerializedError, SendResult,
              StepId, ViewId, TaskId, ChildStepId, Ctx, ContextInput, InputOf, OutputOf, EventType, PayloadOf, FlowOutput, ProjectionOutput }
// @openwizard/react
export { bindReact }   // bindReact<typeof flowOrProjection>() → { Provider, useSnapshot, useCurrent, useStep, useSelector, useActions }
```

Naming rules: `define*` = inert data, `create*` = live thing; instance noun is `Wizard` (brand); `send` = external events in, `dispatch` = wire commands in, `observe` = events out; `getSnapshot/subscribe` (feeds `useSyncExternalStore` and the Store).

### End-to-end target example (must compile without casts at the end of Phase 1)

```ts
// flows/checkout.ts (server; client imports type-only)
import { defineFlow, clientState } from '@openwizard/core'
import { z } from 'zod'

export const fulfilment = defineFlow({
  context: z.object({ orderId: z.string(), express: z.boolean() }),
  steps: (s) => ({
    label: s.task({ run: ({ context }) => shipping.createLabel(context), next: 'done' }),
    done:  s.final({ output: ({ steps }) => ({ trackingId: steps.label.output?.trackingId }) }),
  }),
})

export const checkout = defineFlow({
  name: 'checkout',
  context: z.object({ cartId: z.string(), total: z.number(), express: z.boolean().default(false),
                      paymentId: z.string().optional(), declineReason: z.string().optional() }),
  events: {
    'payment.captured': z.object({ paymentId: z.string(), amount: z.number() }),   // webhook body → boundary
    'payment.failed':   z.object({ reason: z.string() }),
  },
  onFailure: 'compensate',
  steps: (s) => ({
    shipping: s.view({
      input: z.object({ address: z.string().min(1), express: z.boolean().default(false) }),
      exit: ({ output, update }) => update({ express: output.express }),
      next: 'reserve',
    }),
    reserve: s.task({
      run: ({ context, signal }) => inventory.reserve(context.cartId, { signal }),
      retry: { attempts: 3, backoff: 'exponential' },
      compensate: ({ output }) => inventory.release(output.reservationId),
      next: 'awaitPayment',
    }),
    awaitPayment: s.wait({
      enter: ({ context }) => payments.createIntent(context.cartId, context.total),
      on: {
        'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }),
        'payment.failed':   ({ payload, update }) => update({ declineReason: payload.reason }),
      },
      timeout: { after: '15m', next: 'expired' },
      next: 'route',
    }),
    route:  s.decision({ next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined') }),
    fulfil: s.flow(fulfilment, {
      context: ({ context }) => ({ orderId: context.cartId, express: context.express }),
      expose: { output: true },
      next: 'receipt',
    }),
    receipt: s.final(), declined: s.final(), expired: s.final(),
  }),
  start: 'shipping',
})
export const checkoutClient = clientState(checkout, { expose: { context: ['total', 'express'] } })

// server
const wizard = saved ? resumeWizard(checkout, saved, { store, key })
                     : createWizard(checkout, { context: { cartId, total }, store, key })
wizard.subscribe(() => push(wizard.project(checkoutClient)))          // SSE/WS frame per change
app.post('/webhooks/stripe', (req) => sessions.get(req.body.cartId)?.send('payment.captured', req.body))
app.post('/checkout/:id/cmd', (req) => sessions.get(req.params.id)?.dispatch(req.body))   // after auth

// client
const ow = bindReact<typeof checkoutClient>()                          // type-only import → no server code in bundle
const mirror = createMirror<typeof checkoutClient>({ transport: sse(`/checkout/${cartId}`) })
<ow.Provider source={mirror} fallback={<Spinner/>}>…</ow.Provider>
const { status, input, issues, setInput, next } = ow.useStep('shipping')   // 'typo' is a compile error
```

---

## 3. Type-system strategy (Phase 0 gate)

**Root problem:** step constructors run before the steps object exists, so ids can only be checked at assembly. **Strategy:** constructors are *pre-bound* to `Ctx`/`Events` (so every callback gets a typed `context`/`payload` with no generics) and *capture* every id literal they reference into a phantom `N extends string` slot; assembly checks `N ⊆ keyof steps` via `T & ValidateIds<T>` (naked-`T` inference wins, so a failure does not cascade into `T`).

```ts
// authoring/types.ts (shape; final names in Phase 0)
type Ids<T> = Extract<keyof T, string>
type NextRef<N extends string> = N | readonly N[] | null
type ValidateIds<T> = { readonly [K in keyof T]: {
  readonly next?: NextRef<Ids<T>> | ((...a: never[]) => MaybePromise<NextRef<Ids<T>>>)   // only id-bearing positions
  readonly on?: Record<string, unknown>   // v0.2: handler return targets
  readonly timeout?: { readonly next?: Ids<T> }
} }
interface Step<C, Ev, I, O, N extends string, K extends StepKind, X, CF = never> {
  readonly kind: K
  readonly '~types'?: { input: I; output: O; refs: N; expose: X; child: CF }      // phantom, Standard-Schema style
  readonly input?: Boundary<I>          // I source (pass 1: not context-sensitive)
  readonly initial?: Partial<I>
  readonly output?: Boundary<O>         // O source #1 (order-independent)
  readonly run?: (a: RunArgs<C, Ev, I>) => MaybePromise<O>   // O source #2 (pass 2)
  readonly next?: NextRef<N> | ((a: NextArgs<C, Ev, I, O>) => MaybePromise<NextRef<N>>)
  // enter/exit/canEnter/canExit/validate/compensate/on/timeout/retry/label/expose …
}
interface StepApi<C, Ev> {   // returned pre-bound; each ctor has a CONCRETE param type (excess-property checks work)
  view<I = undefined, O = I, N extends string = never, X = false>(cfg: ViewCfg<C, Ev, I, O, N, X>): Step<C, Ev, I, O, N, 'view', X>
  task<I = undefined, O = I, N extends string = never, X = false>(cfg: TaskCfg<…>): Step<…, 'task', X>
  wait<N extends string = never>(cfg: WaitCfg<C, Ev, N>): Step<…, 'wait'>
  decision<N extends string>(cfg: { next: (a: NextArgs<C, Ev, undefined, undefined>) => MaybePromise<NextRef<N>> }): Step<…, 'decision'>
  flow<CF extends AnyFlow, O = FlowOutput<CF>, N extends string = never>(child: CF, cfg: FlowCfg<C, Ev, CF, O, N>): Step<…, 'flow', false, CF>
  final<O = undefined>(cfg?: { output?: (a: BaseArgs<C, Ev>) => O }): Step<…, 'final'>
}
// Assembly — TWO candidate shapes with IDENTICAL types; Phase 0 picks ONE (error location + inference decide):
//  (A) single call, preferred DX:
declare function defineFlow<CIn, ES extends Record<string, Boundary<any>>, T extends Record<string, AnyStep<ContextOf<CIn>, EventsOf<ES>>>>(def: {
  name?: string; context: CIn /* value | Boundary */; events?: ES; onFailure?: …; retry?: …
  steps: (s: StepApi<ContextOf<CIn>, EventsOf<ES>>) => T & ValidateIds<T>
  start?: Ids<T>
}): Flow<ContextOf<CIn>, EventsOf<ES>, T>
//  (B) two-phase, proven mechanics: const w = createFlow({ context, events }); w.steps({ a: w.view({…}) }, { start: 'a' })
// One extractor per concept (indexed access on '~types', no conditional distribution):
type StepId<F>  = Extract<keyof F['steps'], string>
type InputOf<F, K extends StepId<F>>  = NonNullable<F['steps'][K]['~types']>['input']
type OutputOf<F, K extends StepId<F>> = NonNullable<F['steps'][K]['~types']>['output']
type Ctx<F> = NonNullable<F['~types']>['ctx'];  type EventType<F> = Extract<keyof NonNullable<F['~types']>['events'], string>
type PayloadOf<F, E extends EventType<F>> = NonNullable<F['~types']>['events'][E]
type ChildStepId<F> = { [K in StepId<F>]: [ChildOf<F['steps'][K]>] extends [never] ? never : K }[StepId<F>]
type ViewId<F> / TaskId<F> = kind filters (single mapped type each) → go()/setInput() accept views only, retry() tasks only
```

Boundaries: `Boundary<T> = StandardSchemaV1<unknown, T> | Checker<T>` (`Checker` branded; built by `boundary.parse/guard/assert/trusted`); `InferBoundary<B>`; `BoundaryResult<T> = { ok: true; value: T } | { ok: false; issues: Issue[] }`. `context` on a flow accepts a plain value (trusted defaults, type inferred) or a boundary (validated at `createWizard`/resume); one extractor `ContextOf`.

Circularity rules (documented + pinned by tests): `input`/`output`/`initial` are inferred in pass 1; `run/next/on/…` receive `I`/`O` by contextual typing in pass 2; TS processes context-sensitive functions left-to-right, so `run` must precede `next`/`compensate` unless an `output` boundary is given. No `const` type params on constructors (would freeze `initial`); only `N` captures literals. Interfaces (`Snapshot`, `StepState`) recurse lazily for nesting; eagerly-evaluated aliases (`ClientState`) carry a depth counter (default 4).

Steps are contravariant in `C` (C only in callback params) → a module (`createModule<Ctx>()` returning the same `StepApi`) written for a *subset* context composes into a bigger flow; a module bound to an unrelated context is rejected; module-local `next` into another module is checked at assembly (spread) plus a runtime `UnknownStepId` check.

**Phase 0 spike** (`packages/core/spikes/id-safety.spike.ts`, `tsc --noEmit --strict --extendedDiagnostics`; the placement of each `@ts-expect-error` IS the error-location assertion; a generated 120-step copy measures perf):
1. valid flow: literal capture through string / fn / array / union+null; `context`/`input`/`output` contextually typed in every hook; hover on a step shows a concrete `Step<…>`;
2. `next: 'typo'` → error on the step property line; 3. `next: () => 'typo'` (literal must survive via `N`); 4. `timeout.next` typo; 5. `start: 'b'` typo (and completions);
6. module spread: `{ ...mod, root }` ok, `{ ...mod }` alone rejected; 7. excess property inside a constructor rejected; 8. step bound to an unrelated context rejected, subset context accepted;
9. `next` before `run` — pin the observed behaviour; 10. `initial` vs `input` schema conflict; 11. Zod 4 / Valibot / ArkType / `boundary.guard` / `boundary.trusted` all infer; 12. `ClientState<F, expose>` picks; 13. `child('viewStep')` rejected, `child('flowStep')` typed; 14. `bindReact<typeof projection>().useStep('typo')` rejected.
Verdict criteria: every directive consumed; no cascade errors on the valid flow; 120-step copy: check time < 2 s, instantiations < 500k. Result + numbers → `DECISIONS.md` (ADR-001). Fallback chain: (A) → (B) → F-bounded `steps<T extends {[K in keyof T]: AnyStep & ValidateIds<T>[K]}>` without `const`.

**Type tests (must run):** `packages/*/tests/*.test-d.ts` under `vitest --typecheck` with `tsconfig.test.json` that includes tests (v1's excluded them); plus `tests/__canary__/must-fail.test-d.ts` (a deliberate type error; CI asserts the typecheck job FAILS on it) so a silent harness misconfiguration can never recur.

---

## 4. Repository layout & tooling

- **Workspace:** pnpm workspaces (`packages/*`, `examples/*`); no Nx. Root scripts: `build`, `typecheck`, `test` (`vitest run --typecheck`), `lint` (biome), `check:api`, `check:docs`, `examples`.
- **TypeScript 5.9:** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: bundler`, `module: ESNext`, `target: ES2022`, core `lib: [ES2022]` (no DOM). Tests included by `tsconfig.json`; `tsconfig.build.json` excludes them.
- **Build:** tsdown (ESM + CJS, `dts: true`, sourcemaps, `minify: false`, `platform: neutral`); `publint` + `@arethetypeswrong/cli --pack`; `size-limit` (core ≤ 12 kB brotli, react ≤ 3 kB).
- **Tests:** vitest 3, root `vitest.config.ts` with `projects` + `typecheck: { enabled: true, include: ['**/*.test-d.ts'] }`.
- **Lint/format:** Biome 2 (`biome.json`: `noExplicitAny: error`, `noNonNullAssertion: error` in `src`, `useImportType`, `noConsole`).
- **Releases:** Changesets (fixed group core+react), `release.yml` with npm provenance.
- **CI:** ubuntu + windows × Node 20/22: install → build → typecheck → lint → test(+typecheck) → publint/attw → size → examples typecheck+run. `.gitattributes` `* text=auto eol=lf`.
- **Targets & deps:** core is platform-neutral (Node 20+, browsers, edge/workers; no Node APIs, no DOM types) with **zero runtime dependencies** (`@standard-schema/spec` is a type-only devDependency; Zod/Valibot/ArkType only in tests/examples). `@openwizard/react` peer-depends on `react >= 18` (`useSyncExternalStore`).
- **First commit on `v3`:** the working-tree deletions of the v3 docs/contracts are committed as-is (they stay in history at `06159e2`; the decisions worth keeping are restated in `DECISIONS.md` ADR-000 "Why event-sourced machine + kinds/policies instead of modes"). New scaffold lands in the same or the following commit; no v1/v3 code is copied except the `stepsToGraph` port and the type-test ideas.

Files to scaffold (1-line purpose):

```
.changeset/config.json, .github/workflows/{ci,release}.yml, .gitattributes, .gitignore, .npmrc, .editorconfig
biome.json, package.json (private root), pnpm-workspace.yaml, tsconfig.base.json, tsconfig.json (solution refs), vitest.config.ts
LICENSE (MIT), README.md (pitch + quickstart = examples/01 verbatim + export-table markers), CONTRIBUTING.md (rules), SECURITY.md (persistence: tenant-scoped keys, redact, no stacks, boundaries revalidate on resume, authorize commands), DECISIONS.md (ADR-lite; Phase 0 result goes here first)
api/core.d.ts, api/react.d.ts                       committed d.ts rollups (governance diff)
scripts/{gen-export-tables,check-doc-imports,check-api,check-public-tags}.mjs
packages/core/{package.json,tsdown.config.ts,tsconfig.json,tsconfig.build.json,README.md}
packages/core/src/index.ts                          the ONLY barrel; explicit named exports
packages/core/src/authoring/{define-flow.ts,step.ts,boundary.ts,types.ts,duration.ts,compile.ts}
packages/core/src/machine/{state.ts,commands.ts,events.ts,effects.ts,decide.ts,apply.ts,plan.ts,nav.ts,scheduler.ts,saga.ts,wait.ts,invalidate.ts,selectors.ts,explain.ts}
packages/core/src/interpreter/{interpreter.ts,effects.ts,timers.ts,retry.ts,child.ts,thenable.ts}
packages/core/src/wizard/{create-wizard.ts,resume-wizard.ts}
packages/core/src/projection/{client-state.ts,expose.ts,serialize-error.ts}
packages/core/src/mirror/{create-mirror.ts,local-transport.ts}
packages/core/src/persistence/{store.ts,memory-store.ts,snapshot.ts}
packages/core/src/inspect/graph.ts
packages/core/src/errors.ts
packages/core/spikes/id-safety.spike.ts (+ generated flow-120.spike.ts)      M0 only; deleted or moved to tests after ADR-001
packages/core/tests/**/*.test.ts, **/*.test-d.ts, tests/scenarios/*.test.ts, tests/__canary__/must-fail.test-d.ts
packages/react/{package.json,tsdown.config.ts,tsconfig.json,tsconfig.build.json,README.md}
packages/react/src/{index.ts,bind-react.tsx,use-source.ts}, packages/react/tests/*
examples/01-happy-path … 07-dag-pipeline/{package.json,src/index.ts,index.test.ts,README.md}   (Node + tsx + vitest; each example IS a test)
examples/08-react-mirror/ (Vite + React; typecheck + build in CI)
```

Module → responsibility → tests (core; ~4.5k LOC total):

| Module | Responsibility | Tests |
|---|---|---|
| `authoring/*` | `defineFlow`/`createModule`/`StepApi`, boundaries, duration parsing, `compile.ts` (static validation: unknown ids, cycles, unreachable, start/final) | `.test-d.ts` (§3), unknown-id/cycle runtime errors |
| `machine/decide.ts` | command/result validation → events; nav-busy; stale tokens | rejected commands, stale results ignored |
| `machine/apply.ts` | fold | property test: `replay(log) == state` |
| `machine/plan.ts` | events → effects (kind semantics, autoRun, settle) | effect ordering per event |
| `machine/nav.ts` | pipeline phases, `back`, auto-advance, cursor rules | veto at each phase, back semantics, auto-advance chains |
| `machine/scheduler.ts` | readiness (all/any), concurrency budget, retry/backoff, cancel | split/join, budget, backoff schedule |
| `machine/saga.ts` | stack, reverse order, best-effort | order, partial failure, `compensate({from})` |
| `machine/wait.ts` | routing to `on`, inbox TTL, deadlines | early/late/expired events, resume re-arm |
| `machine/invalidate.ts` | dirty propagation | transitive reset, running cancel, `keep` for views |
| `machine/selectors.ts`, `explain.ts` | derived axes, reasons | memo per `seq`; explain codes |
| `interpreter/*` | queue/drain, effect executor, timeouts/abort, child bridge | sync-commit guarantee, `strict:'sync'`, timeout, re-entrancy |
| `wizard/*` | public façade, promises by `txId`, subscriptions, `child()` | API surface, dispose |
| `persistence/*` | store driver, debounce, snapshot validate | debounce, crash-resume |
| `projection/*`, `mirror/*` | clientState, expose/redact, mirror ack | redaction, mirror `seq` ordering |
| `inspect/graph.ts` | static graph + warnings | graph snapshot tests |

---

## 5. Roadmap — v0.1.0 milestones (user chose "all" for v0.1), then v0.2/v0.3

| Milestone | Deliverables | Exit criteria |
|---|---|---|
| **M0 — Type spike (types only; gate)** | `packages/core/spikes/id-safety.spike.ts` + first `.test-d.ts` proving the 14 cases in §3 (id safety in `next`/`dependsOn`/`timeout.next`/`start`/`go()`/`useStep()`; flow-bound `context`/`input`/`output`/`payload` inference with no generics on `s.*`; boundary inference for Zod/Valibot/ArkType/guard/trusted; `ClientState<F, expose>`; nested `flow` typing; module variance). Choose assembly shape (A) `defineFlow({ steps: (s) => … })` vs (B) `createFlow(...).steps(...)`. | Every directive consumed; no cascade errors; 120-step flow < 2 s / < 500k instantiations; `__canary__` proves the harness fails on a real type error; ADR-001 in `DECISIONS.md` with numbers. |
| **M1 — Scaffold + engine core (sequential)** | Repo/tooling from §4; `boundary.*`; `decide/apply/plan` + interpreter (FIFO queue, sync-commit guarantee, thenable detection, tokens, `strict:'sync'`); all 6 kinds with the nav pipeline; retry/backoff/timeout/`AbortSignal`; compensation (reverse order, best-effort, `saga.failures`); `wait` + `on` handlers + inbox buffer/TTL + persisted `deadline` timers; nested flows + `child()`; snapshot/resume + `createMemoryStore` + `redact` + `autoSave` debounce; event envelope + `observe()` + `log()`; `inspect()` graph; `WizardError`; selectors (`phase`, `available`, `progress`). | Unit tests per module (§ module table); examples 01–06 pass as tests on ubuntu+windows; golden scenarios green: (a) resume-during-wait with timer re-arm, (b) early external event buffered → delivered, TTL variant expires, (c) compensation with partial failure order `[3,2,1]`; sync-commit test. |
| **M2 — DAG / concurrency** | `dependsOn` (all/`any`) + `next: [...]` fan-out + readiness rule + `active[]`/`current` split + `autoRun`/`concurrency`/`runReady()` + invalidation + `inspect()` warnings (unreachable, unsatisfiable, cycles) + `explain()` candidates. | Split/join determinism tests (fake scheduler); concurrency budget test; invalidation cancels running dependents; example 07 (server pipeline: ingest → normalize ∥ enrich → gate → persist, `concurrency: 2`, asserts event order). |
| **M3 — Client + React** | `clientState(flow, {expose})`, `SerializedError`, `Command` JSON + `dispatch` allow-list hook, `createMirror({transport})` (full projected snapshot per `seq`), `createLocalTransport`; `@openwizard/react` `bindReact<typeof x>()` → `Provider/useSnapshot/useCurrent/useStep/useSelector/useActions` over `Wizard \| Mirror` via `useSyncExternalStore`, stable action identities. | React unit tests (render counts via selectors, hook `.test-d.ts` inference incl. `useStep('typo')`); example 08 (Vite app: form step through a Mirror over the loopback transport, `useStep('shipping')` typed from a type-only import) typechecks + builds in CI. |
| **M4 — Release hygiene → publish v0.1.0** | Governance scripts (§6), READMEs with generated export tables (root quickstart = example 01 verbatim), CONTRIBUTING/SECURITY/DECISIONS, `api/*.d.ts` snapshots, changesets, `release.yml` with provenance, size budgets. | publint/attw/size/check:api/check:docs green; zero `any` in `api/*.d.ts`; `pnpm changeset publish` dry-run passes; tag `v0.1.0`. |
| **v0.2.0** | Generic `on` handlers (any kind + flow-level `on`); `when` skip predicate + `skip()`; `defineProjection` + full `Expose`; `toMermaid`; idempotency keys + crash-resume re-run of `running` tasks; snapshot `migrate`; `sources` adapters + correlation ids; Mirror/React support for child flows; `mapError` typed step errors; deps injection; patch/event-stream Mirror; presets as docs. | Example 09 (server-authoritative over `node:http` SSE); regenerated export tables; API snapshot diff reviewed. |
| **v0.3.0** | Docs site (reuse the v1 Monaco landing shell + DAG visualizer, driven by `inspect()` + `observe()`); `@openwizard/devtools` (event log + graph + time travel via `apply`); append-only event Store + replay; store recipes (Redis/Postgres as docs). | Docs `check` pipeline (snippet typecheck, doc-imports, links) green; devtools renders examples 01–09; 1.0 API-freeze proposal. |

Cut from v0.1 (explicit): `mode`; per-step `runtime`/`durability`; generic `on` (only `wait` listens); `when`; `defineProjection`; `toMermaid`; idempotency keys (interrupted `running` task on resume → `failed{kind:'interrupted'}`, user `retry()`s); event-based undo on `back()`; patch/event-stream Mirror + optimistic UI; multi-instance router; presets; typed per-step errors; Vue/Solid bindings.

Non-goals: distributed queue/locks; built-in HTTP server/transports beyond loopback; visual editor; store implementations beyond memory (recipes only); form-library features; auth; exactly-once delivery (idempotency is the task author's job, documented).

---

## 6. Governance & docs parity

- `scripts/gen-export-tables.mjs` writes per-package export tables into READMEs between markers (`--check` in CI).
- `scripts/check-doc-imports.mjs` validates every `import {…} from '@openwizard/*'` in markdown against `src/index.ts`.
- `scripts/check-api.mjs` copies dts rollups to `api/` and diffs; changes require `--update` + a changeset.
- `scripts/check-public-tags.mjs`: every export has TSDoc `@public`; no `@internal` reachable from a public signature.
- CONTRIBUTING rules: one canonical way; no field without consumer+test; every public type has `.test-d.ts` coverage; no `any`/`as` in `api/*.d.ts`; every example is a test; every `WizardError` code in the generated table; size budgets are CI failures; `boundary.trusted` and `!` in examples need a comment.

## 7. Verification (end-to-end)

1. `pnpm i && pnpm build && pnpm typecheck && pnpm lint && pnpm test` green locally (Windows) and in CI (ubuntu+windows × Node 20/22).
2. `pnpm --filter "./examples/*" test` — each example runs its flow to completion and asserts on `log()`: 01 happy path (linear wizard with a task); 02 recoverable failure (retry succeeds on attempt 2, backoff observed via fake scheduler); 03 non-recoverable → compensation order `[3,2,1]` with a failing #2 recorded in `saga.failures`; 04 kills mid-wait, resumes from the memory store, advances the fake clock, asserts the timeout branch; 05 sends a bad payload → `event.rejected` with issues, then a good one, plus an *early* event buffered then delivered; 06 nested flow output + `path` in child events + `child()` access; 07 DAG pipeline (ingest → normalize ∥ enrich → gate → persist) with `concurrency: 2`, asserts parallelism and join order.
3. Type gate: `vitest run --typecheck` executes `*.test-d.ts` (`@ts-expect-error` on `next: 'typo'`, `dependsOn: ['nope']`, `go('typo')`, `useStep('typo')`, `send('unknown', …)`, `useSelector` on an unexposed context field); the `__canary__` job must FAIL (proves the harness works).
4. Sync-commit test: `wizard.next()` on an all-sync flow → `getSnapshot().current` already advanced before `await`; `strict:'sync'` turns a thenable into `SyncViolationError`.
5. Package hygiene: `publint`, `attw --pack`, `size-limit`, `check:api`, `check:docs`, `check:public-tags`.
6. React: `examples/08-react-mirror` typechecks + builds in CI; manual smoke in the browser (Vite dev server): a form step driven through a Mirror over the loopback transport, `useStep('shipping')` typed from a type-only import, no server code in the client bundle (bundle-analyze assertion).

---

## 8. Semantics addendum (post architecture review, 2026-08-17)

An independent architecture review (Codex `gpt-5.6-sol`, xhigh) found the execution model under-specified. These resolutions are binding for M1+ and override earlier sections where they conflict.

### 8.1 Message processing is batch-atomic

```
loop: msg = queue.shift()
  events    = decide(def, state, msg)                    // pure; [] means "no-op"
  nextState = events.reduce(apply, state)                // fold the whole batch
  effects   = plan(def, nextState, events)               // sees POST-batch state + the batch
  commit(nextState, events)                              // append to log, swap state, notify event listeners per event, state listeners ONCE
  for (fx of effects) execute(fx)                        // only after commit; sync results are enqueued and processed in the same drain
```

- Listeners and persistence never observe intermediate states. A `persist` effect is planned on every committed batch that changed state (`autoSave: 'change'`), coalesced by the interpreter (`debounceMs`, default 0 = after each drain).
- **All** messages are serialized through one FIFO queue: commands, effect results, timers, child results. There is no "processed immediately" path. Calls made from inside a listener or hook are enqueued and processed before the outer public call returns.
- **Sync-commit guarantee (precise):** for a public call made from outside a drain, if every hook it triggers returns a non-thenable, the resulting state is committed and listeners notified before the call returns; the returned promise is already settled. `strict: 'sync'` turns the first thenable into a `res.err {syncViolation}` for that hook — the step fails (`kind: 'sync-violation'`) and the transaction is rejected; nothing is rolled back because nothing after the failing hook was committed.
- Every `call` effect carries a token `{ step, runId, attempt?, txId? }`; results whose token no longer matches state produce `result.ignored` and nothing else.

### 8.2 One result contract; throws are programmer errors

- `dispatch(cmd)` never throws for data problems. It resolves to `CommandResult = { ok: true; seq } | { ok: false; code: WizardErrorCode; message; issues?; step? }`.
- Sugar methods return typed results: `next()/go()/back()` → `NavResult`; `send()` → `SendResult`; `retry()/cancel()/runReady()/setInput()/resetInput()/start()` → `CommandResult`. Validation failure is a normal `{ ok: false, code: 'INVALID_INPUT', issues }`, not an exception.
- `WizardError` is thrown only for misuse: `DISPOSED`, `DEFINITION_INVALID`, `SNAPSHOT_INCOMPATIBLE`, `NESTING_CYCLE`, `NESTING_TOO_DEEP`, and `UNKNOWN_EVENT` from `send()` with an undeclared event name (a programming error the types already prevent).
- `validate(step)` is a façade-level pure query (boundary + `validate` hook, no events, no state change).

### 8.3 Activation vs gating (readiness rule, corrected)

- **Activation** happens only by arrival: `start` (string or string[]) or being selected by a completed step's `next`. Arrival at a step that is not active sets `pendingActivation`; arrival at an already-active step is recorded (`step.arrived`) and otherwise ignored.
- **Gating**: `dependsOn` (`all` = AND, `{ any }` = OR) only gates a pending activation. A step never activates because its dependencies completed. `inspect()` warns about steps with `dependsOn` but no incoming `next`/`start` edge (they can never run).
- `ready(step) = pendingActivation && status !== 'active' && depsSatisfied`. Ready `task/decision/wait/flow` steps enter automatically (`autoRun: 'ready'`, tasks bounded by `concurrency`, chosen in activation order); ready views wait for the cursor.
- **Fan-out atomicity**: `next: ['a','b']` from any step evaluates every target's `canEnter` first; if any is `false` the whole transition is rejected (`guard-canEnter`), otherwise all targets are arrived in order. The cursor moves to the first *view* among the targets (`current`); other views stay ready (reachable via `go`).
- **Repeated activation** is allowed (loops via `next`/`back`/`go`): each entry increments `runId`, resets attempt/error/output for that run (a view keeps its draft `input`), `visitedCount++`. Auto-advance chains are capped at 1000 hops per command → `flow.failed { code: 'AUTO_ADVANCE_LOOP' }`. Dependency cycles are rejected at compile time.
- **Terminal rule**: entering a `final` step runs its `output` hook, then `flow.done`; every other active step is cancelled (`step.cancelled { reason: 'flow-done' }`, running tasks aborted). Sibling branches that must complete first should join (`dependsOn`) into the final.
- **Cursor rule**: after every commit, if `current` is null and exactly one view is ready, the cursor moves there (`transition.committed { cause: 'auto' }`); if several are ready the cursor stays null and `explain()` lists candidates.
- `go(step)`: allowed when the target view is `ready` (activated + gated) or was visited before (`history`); runs the full pipeline (parse input + `validate` + `canExit` on the current view unless `direction: 'back'`, then `canEnter` on the target, `exit`, `enter`). `back()` = `go(previous view in history, { direction: 'back' })` — skips `parseInput/validate/canExit` on the current view but runs `exit` and the target's `canEnter/enter`.

### 8.4 Invalidation is NOT automatic (cut from v0.1)

Re-entering a done view (`back`, `go`, loops) does not touch downstream steps. Downstream re-runs are the author's decision (route through them again). Explicit `invalidate(step)` and dependency-selector-based invalidation are v0.2, after idempotency keys exist.

### 8.5 Compensation

- Trigger: a task fails with no retries left and `onFailure === 'compensate'`, or `cancel()`, or `compensate()`.
- Phase 1 (settle): stop scheduling; abort running tasks (`signal`); **wait for every in-flight attempt to settle** (`res.ok`/`res.err`; abort is cooperative, so a late success is recorded and pushed on the stack). Bounded by each task's `timeoutMs` (default grace 30 s when unset).
- Phase 2 (unwind): compensate sequentially in reverse completion `seq` order, each `compensate` call with its own token, `timeoutMs`, and events (`step.compensationStarted/compensated/compensationFailed`); best-effort, failures collected in `saga.failures`. A `flow` step on the stack delegates to the child, which runs its entire compensation before the parent continues.
- During `compensating`, navigation/run/send commands are rejected (`command.rejected { code: 'FLOW_COMPENSATING' }`). Outcome: `flow.compensated { outcome: 'failed' | 'cancelled' }`. `compensate({ from })` re-attempts only entries in `saga.failures`.

### 8.6 External events, inbox, timers

- `send(event, payload)`: unknown event name → `WizardError('UNKNOWN_EVENT')` (programmer error); boundary failure → `event.rejected {issues}` and `SendResult { ok: false, reason: 'rejected', issues }`.
- Routing: delivered (broadcast) to **every** active `wait` step whose `on` has the event; each consumes independently. No listener → buffered if `unmatchedEvents.buffer` (`event.buffered`, FIFO, `expiresAt = at + ttlMs`) else `event.dropped`. `SendResult { ok: true, delivered: StepId[], buffered: boolean }` resolves when the routing decision is committed (handler completion is observable via events, not via `send`).
- Handler throws → the wait step fails (`kind: 'hook'`) → `onFailure` policy applies. Handler returns `{ next }` → that target is used instead of the step's static `next`.
- Inbox drain: when a wait step enters, matching buffered events are delivered in FIFO order (oldest first) before its timeout is armed; expiry is checked lazily on every drain and by one coarse TTL timer per entry.
- Timers are state (`timers[id] = { at, fire }`), persisted, and re-armed on resume: **inbox is drained first, then overdue timers fire in `at` order.** Timer callbacks and event deliveries both check tokens; only the first valid completion wins.

### 8.7 Nesting

- `path: string[]` (structured segments; ids may contain any character). Child events are forwarded to the parent's `observe()` with their own `path`+`seq`; a single causal stream is `(path, seq)` ordered by parent receipt.
- Child instance = own interpreter, own `instanceId`, own snapshot nested under `Snapshot.children[stepId]`. Parent state keeps a `ChildSummary`. Max depth 8; embedding an ancestor flow → `WizardError('NESTING_CYCLE')` at compile time.

### 8.8 Persistence & resume (recovery matrix)

Snapshot: `{ v: 1, flow: { name, version }, instanceId, epoch, seq, savedAt, state, children }`. `name` is required on every flow. Resume validation: envelope + flow identity + step-set equality + status invariants + JSON safety (no functions/undefined/non-plain objects) + all boundaries (context, view outputs, event payloads in inbox) → else `WizardError('SNAPSHOT_INCOMPATIBLE')` with a reason list. `epoch` increments on every resume so a restarted instance is distinguishable to Mirrors.

| Persisted situation | On resume |
|---|---|
| `nav.phase !== 'idle'` | transaction aborted: `transition.rejected { reason: 'resumed' }`, `nav` → idle, `from` stays active |
| task active (running) | `step.failed { kind: 'interrupted' }`; `retry(step)` re-runs (v0.2 adds idempotency-key auto re-run) |
| task with `retryAt` | timer re-armed (fires immediately if overdue) |
| wait active with `deadline` | inbox drained first, then the timer is re-armed / fired if overdue |
| flow step active | child restored from `children[step]`; missing → child re-created |
| `compensating` | continue unwinding from the stack (skip `compensated`) |
| terminal (`done/failed/cancelled`) | restored read-only; commands rejected `FLOW_TERMINAL` |
| inbox entries | restored; expired ones dropped with `event.expired` |

The log is a bounded trace, not the source of truth (`replay(log) == state` is a property test on flows shorter than `logSize`); durable tracing is the host's job via `observe()`.

### 8.9 Mirror wire protocol (v0.1)

```ts
type Frame<P>   = { kind: 'snapshot'; instanceId: string; epoch: number; seq: number; state: P }
type WireCmd    = { commandId: string; instanceId: string; expectedSeq?: number; command: unknown }   // decoded with parseCommand()
type WireAck    = { commandId: string; result: CommandResult; seq: number }
```
- Server: on subscribe, sends the current frame immediately; then one frame per committed batch (full projected snapshot in v0.1). Mirror ignores frames with `(epoch, seq)` not newer than the last applied; an `epoch` change resets local state.
- Commands are decoded with `parseCommand(unknown)` (runtime validation of the JSON shape) before `dispatch`; `expectedSeq` mismatch → `{ ok: false, code: 'STALE' }` and the client resyncs from the next frame.
- Projections are deny-by-default: `defineProjection(flow, { expose: { steps: { shipping: { input: true } }, context: ['total'] } })`; nothing else crosses the wire.

### 8.10 API deltas from §2 (superseding)

- `s.task(run, options)` — two arguments so `options.next/compensate` see `output` regardless of property order.
- `context` is always a Boundary; `createWizard(flow, { context, deps })`. `deps?: Boundary<D>` on the flow (`boundary.trusted<D>()`), `deps` in every hook — no closing over globals for out-of-domain services.
- `DraftOf<F,K>` (partial schema INPUT; `setInput` patch, `steps[k].input`) vs `OutputOf<F,K>` (schema OUTPUT / run result / `{event,payload}` / child output).
- `defineProjection(flow, { expose })` replaces `clientState()`; `parseCommand(unknown)` exported; `runReady()` on `Wizard` and in `Command`; `epoch` in state; `flow.name` required.
- Removed from v0.1: automatic invalidation, `createModule`, static unsatisfiable-path analysis. Kept: unreachable/cycle warnings in `inspect()`.

### 8.11 M0 spike verdict (ADR-001) — authoring shape (B), superseding §2/§3 where they differ

```ts
const s = defineFlow({ name: 'checkout', version: 1, context: CheckoutCtx, events: { 'payment.captured': PaymentCaptured }, deps: boundary.trusted<Deps>(), onFailure: 'compensate' })
export const checkout = s.steps({
  shipping: s.view({ input: Address, next: 'reserve' }),
  reserve:  s.task(({ context, deps, signal }) => deps.inventory.reserve(context.cartId, { signal }), {
              retry: { attempts: 3, backoff: 'exponential' },
              compensate: ({ output, deps }) => deps.inventory.release(output.reservationId),
              next: 'awaitPayment' }),
  awaitPayment: s.wait({ on: { 'payment.captured': ({ payload, update }) => update({ paymentId: payload.paymentId }) }, timeout: { after: '15m', next: 'expired' }, next: 'route' }),
  route:    s.decision({ next: ({ context }) => (context.paymentId ? 'fulfil' : 'declined') }),
  fulfil:   s.flow(fulfilment, { context: ({ context }) => ({ orderId: context.cartId }), next: 'receipt' }),
  receipt:  s.final(), declined: s.final(), expired: s.final(),
}, { start: 'shipping' })
```
- `defineFlow(options)` returns a `FlowBuilder` (pre-bound `view/task/wait/decision/flow/final` + `steps`); `.steps(defs, { start })` returns the inert `Flow`. Shape (A) (`steps: (s) => …` callback) was rejected: an error inside the callback degrades `typeof flow` (TS overload-failure re-inference); (B)'s literal is not context-sensitive so `StepId<typeof flow>` stays precise even when the id check fails.
- `steps<T>(steps: T & CheckSteps<T, C, Ev, D>, …)` with `T` deliberately unconstrained; errors are custom template-literal messages on the offending step property (`step 'a' references unknown step id(s): 'typo'`; `step 'x' is bound to a different context/events/deps than this flow`; dynamic keys rejected).
- `Boundary<O, I = O>`; `DraftOf` = schema INPUT side (partial), `OutputOf`/hooks = OUTPUT; `ContextInput<F>` vs `Ctx<F>`; `I = never` when a step has no draft, `O = undefined` when no output.
- Sibling `steps` inside step-level hooks are an open, untyped map — the typed idiom is `update()` into context. Step-level `expose` is dropped (projection is deny-by-default and decides exposure). `AbortSignalLike` is structural (no DOM lib requirement for consumers).
- Perf: 120-step flow ≈ +0.2 s / +80k instantiations on TS 5.9.3; emitted d.ts 193 KB; declaration consumer typechecks in 0.08 s.
