# ADR-001 — Authoring type strategy: pre-bound constructors, phantom id capture, `T & CheckSteps<T>` assembly

- Status: accepted (2026-08-18) — shape (B) implemented as `defineFlow` + `FlowBuilder.steps` (link from `DECISIONS.md`)
- Context: `docs/design/architecture-plan.md` §2 (target API), §3 (type-system strategy, 14 spike cases), plus the architecture-review changes (task shape, boundary-only context, deps, wait output, deny-by-default projections, `name` required)
- Evidence: the M0 spike files (`packages/core/spikes/**` — `id-safety.spike.ts` with 31 `@ts-expect-error` location assertions + `Expect<Equal<…>>` type tests, `gen-flow-120.mjs` → `flow-120.spike.ts` (shape A) / `flow-120b.spike.ts` (shape B), `consumer/` as the declaration-emit gate). The spikes have since been deleted: their cases live on as `packages/core/tests/types/*.test-d.ts` (run by `vitest --typecheck`, guarded by `pnpm test:canary`) and the numbers below are the record.
- Toolchain: TypeScript 5.9.3, Node 24.14.0, Windows 11 (`tsconfig.base.json` strictness: `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `lib: ES2022` without DOM)

Reproduce today: `pnpm test` runs the ported cases (`packages/core/tests/types/*.test-d.ts`, through
`vitest --typecheck`; `pnpm test:canary` proves the checker sees errors there). The original spike
commands, kept for the record (the files no longer exist):

```sh
node packages/core/spikes/gen-flow-120.mjs && node packages/core/spikes/gen-flow-120.mjs --shape B
npx tsc -p packages/core/spikes/tsconfig.json --extendedDiagnostics            # must be error-free (all directives consumed)
npx tsc -p packages/core/spikes/tsconfig.json --noEmit false --declaration --emitDeclarationOnly --declarationMap false --outDir packages/core/spikes/dist
npx tsc -p packages/core/spikes/consumer/tsconfig.json --extendedDiagnostics   # consumer of the emitted .d.ts only
```

## Decision (short)

1. **Assembly shape: (B) two-phase** — `const s = createFlow({ name, context, events?, deps?, …policies })` (returns a `FlowBuilder` = the pre-bound `StepApi` + `.steps()`), then `export const flow = s.steps({ a: s.view({…}), … }, { start: 'a' })`. Shape (A) `defineFlow({ …, steps: (s) => ({…}), start })` passes every case too and stays specified below as the documented alternative; (B) wins on inference robustness (see "Why (B)"). Naming (`createFlow` vs re-using the `defineFlow` name for the header call) is a product decision; the mechanics are identical.
2. **Type layer as specified in the plan, with these amendments (all forced by TS, each explained below):**
   - `s.task(run, options)` — two arguments; `O` is fixed from argument 1 (`R`, `O = Awaited<R>` unless an `output` boundary is given). No property-order dependence anywhere else (all other `output` types come from boundaries or from argument 1).
   - `T` (the steps map) is **unconstrained** in the assembly signature and validated by `T & CheckSteps<T, C, Ev, D>` where the check is a *conditional* mapped type (no inferrable structure while `T` is generic). A `T extends Record<string, AnyStep>` constraint poisons inference (§ Findings F1).
   - `Step` fields are **required-or-`undefined`** (not optional) so the id error message is the clean "Property '~error' is missing…" instead of TS2375's misleading `exactOptionalPropertyTypes` wording (F5).
   - `Flow.steps` is typed as the **compact** `{ [id]: FlowStep<I, O, N, K, X, CF> }` (kind + phantom only; C/Ev/D not repeated per step) — cuts hover/.d.ts size 8× (F7).
   - `I = never` for steps without a draft input; `O = undefined` (never `never`) for steps without an output value (F6).
   - Sibling `steps` inside step-level hooks are an **open map** (`SiblingStates`, unknown input/output): typing them per flow is impossible in a single pass (L1). The typed idiom is `context`; typed sibling access *is* possible at the flow level (intra-expression inference) and is recorded as the escape hatch.
3. Verdict criteria: **all met** — every `@ts-expect-error` consumed, zero errors on the valid flows, `checkout.steps.reserve` hovers as a concrete `FlowStep<never, { reservationId: string }, "awaitPayment", "task", never, never>`, 120-step file: +75k instantiations / +0.2 s (limits 500k / 2 s).

## Signatures that worked (verbatim from the spike)

```ts
// Boundaries — any Standard Schema (Zod 4 / Valibot / ArkType) or a branded checker
export interface Checker<O, I = O> { readonly '~checker': 'parse' | 'guard' | 'assert' | 'trusted'; readonly '~types'?: { readonly input: I; readonly output: O } }
export type Boundary<O, I = O> = StandardSchemaV1<I, O> | Checker<O, I>
export declare const boundary: { parse<T>(fn: (v: unknown) => T): Checker<T>; guard<T>(fn: (v: unknown) => v is T): Checker<T>; assert<T>(fn: (v: unknown) => asserts v is T): Checker<T>; trusted<T>(): Checker<T> }

// Step (constructor result) — every config field present (undefined when unset), phantom in '~types'
export interface StepTypes<I, O, N extends string, X, CF> { readonly input: I; readonly output: O; readonly refs: N; readonly expose: X; readonly child: CF }
export interface Step<C, Ev, D, I, O, N extends string, K extends StepKind, X, CF> {
  readonly kind: K
  readonly '~types': StepTypes<I, O, N, X, CF> | undefined
  readonly next: NextSpec<C, D, O, N> | undefined
  readonly dependsOn: DependsOn<N> | undefined
  // … input/initial/validate/canEnter/canExit/enter/exit/run/output/retry/timeout/compensate/on/child/context/deps/expose/label, all `X | undefined`
}
export type AnyStep<C = any, Ev = any, D = any> = Step<C, Ev, D, any, any, string, any, any, any>
// What Flow.steps[k] is typed as (compact)
export interface FlowStep<I, O, N extends string, K extends StepKind, X, CF> { readonly kind: K; readonly '~types': StepTypes<I, O, N, X, CF> | undefined }
export type CompactStep<S> = S extends { readonly kind: infer K extends StepKind; readonly '~types': StepTypes<infer I, infer O, infer N, infer X, infer CF> | undefined } ? FlowStep<I, O, N, K, X, CF> : never

// Pre-bound constructors — no `const` type params; only N (ids) and X (expose) capture literals
export interface StepApi<C, Ev, D> {
  view<I = never, O = [I] extends [never] ? undefined : I, N extends string = never, X extends Expose = never>(cfg: ViewCfg<C, D, I, O, N, X>): Step<C, Ev, D, I, O, N, 'view', X, never>
  task<R, O = Awaited<R>, N extends string = never, X extends Expose = never>(run: (a: RunArgs<C, D>) => R, options?: TaskOptions<C, D, O, N, X>): Step<C, Ev, D, never, O, N, 'task', X, never>
  wait<N extends string = never>(cfg: WaitCfg<C, Ev, D, N>): Step<C, Ev, D, never, WaitOutput<Ev>, N, 'wait', never, never>
  decision<N extends string>(cfg: DecisionCfg<C, D, N>): Step<C, Ev, D, never, undefined, N, 'decision', never, never>
  flow<CF extends AnyFlow, O = FlowOutput<CF>, N extends string = never, X extends Expose = never>(child: CF, cfg: FlowCfg<C, D, CF, O, N, X>): Step<C, Ev, D, never, O, N, 'flow', X, CF>
  final<O = undefined>(cfg?: FinalCfg<C, D, O>): Step<C, Ev, D, never, O, never, 'final', never, never>
}
// cfg shapes (concrete interfaces → excess-property checks work):
//   ViewCfg { input?: Boundary<O, I>; initial?: Partial<I>; validate?; canEnter?; canExit?; enter?; exit?; next?; dependsOn?; expose?; label? }
//   TaskOptions { output?: Boundary<O, unknown>; retry?; timeout?: Duration; compensate?; enter?; exit?; next?; dependsOn?; expose?; label? }
//   WaitCfg { on: OnHandlers<C, Ev, D, N>; timeout?: { after: Duration; next: N }; enter?; exit?; next?; dependsOn?; label? }
//   DecisionCfg { next: (a: NextArgs<C, D, undefined>) => MaybePromise<NextRef<N>>; dependsOn?; label? }
//   FlowCfg { context: (a) => ContextInput<CF>; deps?: (a) => DepsOf<CF>; output?: Boundary<O, unknown>; exit?; next?; dependsOn?; expose?; label? }
//   FinalCfg { output?: (a: BaseArgs<C, D>) => O; label? }
export type NextRef<N extends string> = N | readonly N[] | null
export type NextSpec<C, D, O, N extends string> = NextRef<N> | ((a: NextArgs<C, D, O>) => MaybePromise<NextRef<N>>)
export type DependsOn<N extends string> = readonly N[] | { readonly any: readonly N[] }
export type WaitOutput<Ev> = { [E in keyof Ev]: { readonly event: E; readonly payload: Ev[E] } }[keyof Ev]
export type OnHandlers<C, Ev, D, N extends string> = { readonly [E in keyof Ev]?: (a: EventArgs<C, D, Ev[E], E>) => MaybePromise<void | undefined | { readonly next?: NextRef<N> | undefined }> }
// Hook args: BaseArgs<C, D> = { context: C; update(patch: Partial<C>): void; deps: D; steps: SiblingStates; step: string; path: string; signal: AbortSignalLike }
//   RunArgs +attempt · EnterArgs +from · OutputArgs +output · ExitArgs +output,to · CompensateArgs +output,reason? · EventArgs +event,payload · NextArgs = OutputArgs

// Assembly-time validation
export type Ids<T> = Extract<keyof T, string>
export type RefsOf<S> = S extends { readonly '~types': infer P } ? (NonNullable<P> extends { readonly refs: infer R } ? R : never) : never
export type ValidateSteps<T, C, Ev, D> = {
  readonly [K in keyof T]: [RefsOf<T[K]>] extends [Ids<T>]
    ? T[K] extends AnyStep<C, Ev, D> ? unknown
      : { readonly '~error': `step '${K & string}' is bound to a different context/events/deps than this flow` }
    : { readonly '~error': `step '${K & string}' references unknown step id(s): '${Exclude<RefsOf<T[K]>, Ids<T>> & string}'` }
}
export type NoDynamicKeys<T> = string extends keyof T ? { readonly '~error': 'steps must be declared with literal keys' } : unknown
export type CheckSteps<T, C, Ev, D> = ValidateSteps<T, C, Ev, D> & NoDynamicKeys<T>

// (B) chosen
export interface FlowBuilder<C, CIn, Ev, D> extends StepApi<C, Ev, D> {
  steps<T>(steps: T & CheckSteps<T, C, Ev, D>, opts?: { readonly start?: NoInfer<Ids<T>> }): Flow<C, CIn, Ev, D, { readonly [K in keyof T]: CompactStep<T[K]> }>
}
export declare function createFlow<C, CIn, Ev = {}, D = unknown>(def: FlowOptions & {
  readonly name: string; readonly version?: number
  readonly context: Boundary<C, CIn>
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown> }   // Ev inferred by reverse mapping (no conditional)
  readonly deps?: Boundary<D, unknown>
}): FlowBuilder<C, CIn, Ev, D>
// (A) alternative — identical types; `T = any` and `NoInfer` are the failure-path band-aids explained in F2
export declare function defineFlow<C, CIn, Ev = {}, D = unknown, T = any>(def: FlowOptions & {
  readonly name: string; readonly version?: number; readonly context: Boundary<C, CIn>; readonly events?: …; readonly deps?: …
  readonly steps: (s: StepApi<C, Ev, D>) => T & CheckSteps<T, C, Ev, D>
  readonly start?: NoInfer<Ids<T>>
}): Flow<C, CIn, Ev, D, { readonly [K in keyof T]: CompactStep<T[K]> }>
export declare function createModule<C, Ev = {}, D = unknown>(): StepApi<C, Ev, D>

// Flow + extractors (one per concept, indexed access on '~types', no distributive conditionals)
export interface Flow<C, CIn, Ev, D, T> extends FlowOptions { readonly '~types': { ctx: C; ctxIn: CIn; events: Ev; deps: D; steps: T } | undefined; name; version?; context: Boundary<C, CIn>; events?; deps?; steps: T; start?: Ids<T> }
export type Ctx<F> = NonNullable<F['~types']>['ctx'];  ContextInput<F> = …['ctxIn'];  DepsOf<F> = …['deps'];  EventMapOf<F> = …['events']
export type EventType<F> = Extract<keyof EventMapOf<F>, string>;  PayloadOf<F, E> = EventMapOf<F>[E]
export type StepId<F> = Extract<keyof F['steps'], string>;  StepTypesOf<F, K> = NonNullable<F['steps'][K]['~types']>
export type InputOf<F, K> = StepTypesOf<F, K>['input'];  DraftOf<F, K> = Partial<InputOf<F, K>>;  OutputOf<F, K> = StepTypesOf<F, K>['output'];  ChildFlowOf<F, K> = StepTypesOf<F, K>['child'];  KindOf<F, K> = F['steps'][K]['kind']
export type ViewId<F> = { [K in StepId<F>]: [KindOf<F, K>] extends ['view'] ? K : never }[StepId<F>]        // TaskId likewise with 'task'
export type ChildStepId<F> = { [K in StepId<F>]: [ChildFlowOf<F, K>] extends [never] ? never : K }[StepId<F>]
export type FlowOutput<F> = { [K in StepId<F>]: [KindOf<F, K>] extends ['final'] ? OutputOf<F, K> : never }[StepId<F>]
// Projection (deny-by-default) — defineProjection<F, const E extends ExposeSpec<F>>(flow, { expose: E }): Projection<F, E>
//   ClientState<F, E, Depth = 8>: context: Pick<Ctx<F>, exposed>; steps[k] = base & (input exposed ? { input?: DraftOf } : {}) & (output ? { output?: OutputOf } : {}) & (child ? { child?: ClientState<Child, E.child, Depth-1> } : {}); depth 0 → ClientStateFallback
// Wizard<F>: go/setInput/resetInput/validate accept ViewId<F>; retry TaskId<F>; send EventType<F>; child<K extends ChildStepId<F>>(k): Wizard<ChildFlowOf<F, K>>
// createWizard(flow, { context: ContextInput<F>, deps: DepsOf<F> (required iff declared), … });  bindReact<P>(): ReactBinding<P> (named interface — see F7)
```

## Cases and verdicts

| # | Case (plan §3 / review) | Result | Where the error lands |
|---|---|---|---|
| 1 | §2 end-to-end example (adapted: `task(run, opts)`, `deps`, `defineProjection`, `name`) | ✅ cast-free; literals captured through string / fn / array / union+null / `timeout.next` / handler `{ next }`; every hook has typed `context`/`input`/`output`/`payload`/`deps` | — |
| 2 | `next: 'typo'` | ✅ | the step's property line (both shapes) |
| 3 | `next: () => 'typo'` (literal survives via `N`) | ✅ | property line |
| 4 | `timeout.next` typo | ✅ | property line |
| 5 | `start: 'typo'` | ✅ `Type '"typo"' is not assignable to type '"a" \| "b"'` (completions come from `Ids<T>`) | the `start` line |
| 6 | module spread: `{ ...mod, root }` ok; `{ ...mod }` alone rejected | ✅ | spread → the callback / `.steps()` argument (spreads cannot be elaborated per property); message still names the step and the missing id |
| 7 | excess property inside a constructor | ✅ | the excess property |
| 8 | step bound to unrelated context rejected; subset context accepted; deps-requiring module rejected in a deps-less flow | ✅ (contravariance in C/D via `T[K] extends AnyStep<C, Ev, D>`) | property line: `step 'u' is bound to a different context/events/deps than this flow` |
| 9 | order dependence | ✅ none with `task(run, options)` (tested `compensate`/`next`/`exit` before everything, `output` boundary overriding `run`); legacy single-object shape pinned: `compensate` before a *context-sensitive* `run` sees `output: unknown` (a parameter-less `run` was accidentally order-independent because it is inferred in pass 1) | — |
| 10 | `initial` vs `input`; INPUT vs OUTPUT with `.default()`/`.transform()` | ✅ `initial: Partial<InferInput>`, `DraftOf` = INPUT side, `OutputOf`/hooks = OUTPUT side; conflict reported on `initial`, schema wins (no cascade) | `initial` line |
| 11 | Zod 4 / Valibot / ArkType / `boundary.guard` / `boundary.trusted` / `boundary.parse` — context, input, events, deps | ✅ all infer input *and* output (Valibot `optional(number(), 0)` gives ctx input ≠ output) | — |
| 12 | `ClientState<F, expose>` picks (deny-by-default) | ✅ unexposed fields **absent** (not optional); unknown step id / context key in `expose` rejected | `expose` line |
| 13 | `child('viewStep')` rejected, `child('flowStep')` → `Wizard<typeof fulfilment>`; `go`/`setInput` views only, `retry` tasks only, `send` known events only, `deps` required iff declared | ✅ | call site |
| 14 | `bindReact<typeof projection>().useStep('typo')` rejected; `mirror.go('task')` rejected | ✅ | call site |
| R1 | wait output = union over ALL flow events; `on`/`timeout`/`next` any order; unknown event name in `on` rejected | ✅ | `on` line |
| R2 | dynamic/computed string keys in `steps` | ✅ rejected by `NoDynamicKeys` (computed *literal* keys allowed) | callback / argument |
| R3 | duplicate keys across a spread | ✅ `m1: …, ...mod` → TS2783 (built-in); `...mod, m1: …` compiles (explicit wins silently) → runtime must check duplicates/unknown ids in `compile.ts` | property |
| R4 | `next` returning a widened `string` / a `string` variable | ✅ rejected (`refs: string ⊄ ids`) | property line |
| R5 | nested depth 1..8 through `ClientState`, 9th level | ✅ levels 1–8 precise, level 9 = `ClientStateFallback`; a real 2-level `defineProjection` typed | — |
| R6 | declaration emit + separate consumer | ✅ emits without errors (no inaccessible/private types leak; only `@standard-schema/spec` is imported — Zod/Valibot/ArkType do **not** appear in a flow's .d.ts); consumer typechecks (0.08 s) with `useStep('typo')` still rejected | — |
| X | `name` required, `version?` | ✅ | def object |

## Error text (exact `tsc` output, `next: 'typo'`, shape A line 7 / shape B line 13)

```
packages/core/spikes/errtext.ts(7,5): error TS2322: Type 'Step<SmallCtx, {}, unknown, never, undefined, "typo", "view", never, never>' is not assignable to type 'Step<SmallCtx, {}, unknown, never, undefined, "typo", "view", never, never> & { readonly '~error': "step 'a' references unknown step id(s): 'typo'"; }'.
  Property ''~error'' is missing in type 'Step<SmallCtx, {}, unknown, never, undefined, "typo", "view", never, never>' but required in type '{ readonly '~error': "step 'a' references unknown step id(s): 'typo'"; }'.
packages/core/spikes/errtext.ts(13,3): error TS2322: Type 'Step<SmallCtx, {}, unknown, never, undefined, "typo", "view", never, never>' is not assignable to type 'Step<SmallCtx, {}, unknown, never, undefined, "typo", "view", never, never> & { readonly '~error': "step 'a' references unknown step id(s): 'typo'"; }'.
  Property ''~error'' is missing in type 'Step<SmallCtx, {}, unknown, never, undefined, "typo", "view", never, never>' but required in type '{ readonly '~error': "step 'a' references unknown step id(s): 'typo'"; }'.
```

Column 5 / column 3 = the `a:` property name. Function form (`next: ({ context }) => context.b > 0 ? 'b' : 'typo'`) reports the same shape with `"typo" | "b"` in the refs slot; `start: 'typo'` reports `error TS2322: Type '"typo"' is not assignable to type '"a" | "b"'` on the `start` line. Before F5 the first line read `error TS2375: … with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.` — misleading, hence required-or-undefined fields.

Location degradations (both shapes, documented): a **block-bodied** callback `(s) => { …; return {…} }` and a **hoisted** steps object (`s.steps(hoisted)`) move the error to the callback / argument (TS only elaborates expression-bodied arrows and inline object literals per property); the message still names the property and the bad id.

## Perf (`--extendedDiagnostics`, best of 3, this machine)

| Program | Files | Types | Instantiations | Memory | Check time | Total |
|---|---|---|---|---|---|---|
| `id-safety.spike.ts` alone (type layer + all cases) | 277 | 17,200 | 64,060 | ~121 MB | 0.34 s | 0.66 s |
| + `flow-120.spike.ts` (shape A, 120 steps) | 278 | 27,893 | 139,245 (**Δ 75,185**) | ~126 MB | 0.48–0.56 s (**Δ ≈ 0.15–0.2 s**) | 0.80 s |
| + `flow-120b.spike.ts` (shape B, 120 steps) | 278 | 27,936 | 146,816 (**Δ 82,756**) | ~129 MB | 0.51–0.54 s | 0.84 s |
| whole spike project (`tsc -p`, all three) | 281 | 37,501 | 223,440 | ~215 MB | 0.60–0.69 s | 0.96 s |
| consumer of the emitted `.d.ts` | 63 | 2,767 | 7,499 | ~145 MB | 0.08 s | 0.28 s |

Limits (< 2 s, < 500k) are met with an order of magnitude to spare; ~630 instantiations per step. The 120-step file exercises view/task/wait/decision (12-kind cycle), string / array / function `next`, `dependsOn` (all/any), a 5-event map, typed deps, one projection, `Wizard` calls and `bindReact`.

Declaration emit (`--declaration --emitDeclarationOnly`, `--declarationMap false`): `flow-120.spike.d.ts` = **192,537 bytes / 6,160 lines** (before F7 compaction: 1,497,159 bytes / 53,505 lines; before naming `ReactBinding`: 562,599 bytes). The flow declaration itself is ~870 lines; every *derived* export (`defineProjection` result, `bindReact` result, `useStep` result) prints the flow type once more (structural, because `C`/`Ev` inferred from schemas are anonymous types).

## Findings that changed the design (what was tried, in order)

- **F1 — never constrain `T` with `Record<string, AnyStep<…>>`.** First attempt (`T extends StepMap<C, Ev, D>`, `ValidateIds` template `{ '~types'?: { refs: Ids<T> } }`) produced `Step<…, any, string, 'task', any, …>` for every step: the constraint's index signature became the *contextual return type* of each `s.*` call inside the callback (`getApparentType(T)` = constraint), its `any`/`string` arguments were inferred at `ReturnType` priority and — via the call's `returnMapper` — widened `next: 'done'` to `string`. Same effect when the mapped-type template itself contained `AnyStep<C, Ev, D>` (visible through `substituteIndexedMappedType`). Fix: unconstrained `T`; all checks inside a *conditional* template (deferred while `T` is generic; resolves to `unknown` on the silent-`never` pass). The plan's `[T] extends [never]` guard in `Ids` became unnecessary and was removed.
- **F2 — the (A) callback is context-sensitive → `T` is lost on any error.** With `steps: (s) => …`, TS re-infers a failed call without context-sensitive arguments (`getCandidateForOverloadFailure` → `SkipContextSensitive`), so the *result type* falls back to `T`'s default: `unknown` ⇒ `StepId = never` ⇒ every downstream use errors ("not assignable to never"); `Record<string, AnyStep>` ⇒ trips `NoDynamicKeys` and *hides the real error* (a missing `name` was reported as a bogus `steps` mismatch); `never` ⇒ same. Chosen band-aid for (A): `T = any` (loose while broken, no cascade) + `NoInfer<Ids<T>>` on `start` (otherwise `start: 'shipping'` alone infers `T = { shipping: any }` through `LiteralKeyof` contra-inference and `StepId` becomes `'shipping'`). Errors are still computed with the fully inferred `T` (property-precise). **(B) does not have this problem at all**: the steps object literal is not context-sensitive (its members are calls), so `T` is inferred in pass 1 and stays precise even when the check fails (`_caseBNoCascade`: `StepId<typeof badB>` = `'a' | 'b'`, `refs` = `'typo'`). This is the deciding difference.
- **F3 — return-type "poison" is real; keep constructor return types free of inferrable structure in contextual positions.** Related to F1; the fix generalises: nothing in the assembly signature may expose members while `T` is generic.
- **F4 — `Ev` inferred by reverse mapping.** `events?: { [E in keyof Ev]: Boundary<Ev[E], unknown> }` infers `Ev` from the object literal without a conditional `EventsOf<ES>`; the input side of event schemas is irrelevant (`unknown`).
- **F5 — required-or-undefined `Step` fields.** With any shared *optional* property TS picks TS2375 wording for the id error (`getExactOptionalUnassignableProperties` fires because optional props carry `missingType`); making the stored `Step` fields `X | undefined` (and `'~types': … | undefined`) yields the clean message. Constructor *config* types stay optional-property interfaces (excess-property checks). The runtime must therefore materialise every key on step records (`undefined` when unset).
- **F6 — `never` vs `undefined`.** `I = never` for steps without a draft is fine (I only sits in covariant positions; `Partial<never>` = `never` avoids the `Partial<undefined>`-vs-`Partial<any>` structural mismatch that rejected module steps). `O = never` breaks `T[K] extends AnyStep<…, any, …>` because `O` sits in contravariant hook parameters (`any` is not assignable to `never`) → `O = undefined` for decision / input-less views / finals without `output`.
- **F7 — compact `Flow.steps` + named result interfaces.** `Flow<…, { [K in keyof T]: CompactStep<T[K]> }>` (mapped type written inline so it prints resolved; an alias `CompactSteps<T>` prints as `CompactSteps<{ a: Step<C, Ev, …> }>` and re-expands) cut the 120-step `.d.ts` from 1.5 MB to 563 KB; naming `bindReact`'s result `ReactBinding<P>` (anonymous object types print the flow once per method) cut it to 193 KB. Extractors only ever read `kind` and `'~types'`, so nothing downstream needs hook signatures.
- **F8 — flow-level typed siblings work, step-level cannot.** `experimentFlowLevelOutput({ context, steps: (s) => …, output: ({ steps }) => steps.label.output?.trackingId })` types `steps` precisely (TS ≥ 4.7 intra-expression inference: `output`'s parameter is fixed after `steps` is checked). Inside a constructor the sibling map is unknowable (see L1).
- **F-bounded fallback** (`defineFlowF<…, T extends { [K in keyof T]: ValidateSteps<T, C, Ev, D>[K] }>`) also compiles the simple case with a property-located, clean TS2741 message, but its `T` collapses to the constraint on failure and it shares (A)'s callback problem — not needed.

### Why (B)

Both shapes satisfy every plan criterion (directive placement, no cascade on valid flows, hover, perf). Per the plan's own tie-break ("error location + inference decide"): error location is identical; inference is strictly more robust in (B) — a typo anywhere in a 120-step flow keeps `typeof flow`, `start` completions, `defineProjection`, `useStep` and every `.test-d.ts` precise, whereas (A) degrades the whole flow to `any`-typed steps until fixed and needs `T = any`/`NoInfer` band-aids. (B) also lets `s` be a module-level const, so a flow can be split across files without `createModule<Ctx, Ev, Deps>()` repetition, and steps objects can be hoisted/tested individually. Cost: two statements instead of one and `start` moving to `.steps(…, { start })`. Perf difference is noise (Δ 7.5k instantiations).

## Known limitations (must be in the implementation brief)

- **L1 — sibling `steps` in step-level hooks are untyped (`SiblingStates` = `{ [id: string]: SiblingState<unknown, unknown> }`).** A constructor runs before its siblings exist and TS fixes the callback's parameter types before it sees the return type; no single-pass shape can type them (proved: parameter-typed `s`, `this`-typing, contextual return types all fail; only a chained builder or the flow-level hook of F8 can). Under `noUncheckedIndexedAccess` `steps.label` is `SiblingState | undefined`, so the plan's `steps.label.output?.trackingId` line does not compile cast-free (pinned by `@ts-expect-error` in `siblingDoor`); the §2 `fulfilment` example was adapted to the typed idiom (`exit` → `update({ trackingId })`, `final.output` reads `context`). Options for M1: keep the open map as an escape hatch (recommended), drop `steps` from hook args, or add the flow-level typed hook.
- **L2 — (A) only: while a flow has an error its steps are `any`-typed** (F2). (B) has no equivalent.
- **L3 — spreads / block bodies / hoisted objects move the error to the callback or argument** (still one error, message names the step + id).
- **L4 — `{ ...mod, m1: … }` silently overrides `m1`** (TS2783 fires only for `{ m1: …, ...mod }`). Runtime `compile.ts` must reject duplicate ids across modules and unknown ids (also covers `Ids` computed from spread modules whose `next` targets are outside the flow — the type check catches these, the runtime double-checks).
- **L5 — `on` handlers must return `void`/`undefined`/`{ next? }`; returning arbitrary values is an error** (weak-type check). `enter`/`exit`/`compensate` may return anything (typed `unknown`; the runtime awaits thenables). `validate` returns `void | readonly Issue[]`.
- **L6 — `.d.ts`/hover size is O(steps) for the flow declaration and O(flow) per derived export**, because `C`/`Ev` inferred from schemas are anonymous. Guidance: apps rarely emit `.d.ts`; libraries exporting flows should annotate derived exports (`export const ow: ReactBinding<typeof checkoutClient>`) or use named context interfaces (`boundary.trusted<CheckoutCtx>()` prints `CheckoutCtx`). Numbers above.
- **L7 — `initial` must be `Partial<InferInput<schema>>` (INPUT side, e.g. `qty: '1'` for a `.transform(Number)` field); `DraftOf` = INPUT side, `OutputOf`/hooks = OUTPUT side; `ContextInput<F>` = schema INPUT (with `.default()` fields optional), `Ctx<F>` = OUTPUT.** For checkers input = output.
- **L8 — no property-order dependence remains** (task via argument position; view/flow `output` types come from boundaries or argument 1; wait output = `WaitOutput<Ev>`; decision/final have a single hook). The plan §3 note "run must precede next/compensate" is obsolete.
- **L9 — `AbortSignalLike` is a structural stand-in** (`{ aborted: boolean; reason: unknown }`) because core compiles with `lib: ES2022` (no DOM `AbortSignal`); the runtime passes a real `AbortSignal`.
- **L10 — step-level `expose: X` is captured in the phantom but not consumed by the projection type** (deny-by-default `defineProjection` is the single source of exposure). Either drop step-level `expose` from the DSL or merge it as an additional allow — the type layer can do either in one line.
- **L11 — `s.flow` `output?` is a *boundary* (re-check of the child output), not a mapping function** (a mapping fn would re-introduce order dependence between `output` and `exit`/`next`); `deps?: (a) => DepsOf<CF>` is optional at the type level even when the child declares deps (recommend: runtime passes the parent's deps through when omitted, else `WizardError`).
- **L12 — `D = unknown` when no `deps` boundary is declared** (so deps-less modules compose into any flow); hooks then see `deps: unknown`.
- **L13 — the 2375-free error message depends on `Step` having no optional properties**; adding an optional field to `Step` later re-introduces the misleading wording (test pins it via the exact-text case in this ADR; add a `.test-d.ts` snapshot in M1).

## Runtime implementation notes (from the type layer)

- Step records: materialise **all** keys (`label, dependsOn, next, expose, input, initial, validate, canEnter, canExit, enter, exit, run, output, retry, timeout, compensate, on, child, context, deps` = `undefined` when unset) and `'~types': undefined`; `kind` set. `Flow` objects: `'~types': undefined`, `steps` = the record of full step objects (typed compactly for consumers; the runtime uses an internal `AnyStep` view).
- Task hooks: `run` is argument 1; `output` boundary (if any) parses `await run()`; the step's output type is the boundary output (else `Awaited<ReturnType<run>>`).
- Views: draft = INPUT side of the `input` boundary; `initial` is a partial draft; on `next()/go()` parse → `validate` → `canExit`; hooks receive the parsed OUTPUT.
- Wait: output is `{ event, payload }`; a handler's `{ next }` overrides the step's `next`; `timeout.next` is an id.
- `createWizard(flow, { context: ContextInput<F>, deps: DepsOf<F> })` — `deps` required iff the flow declares a deps boundary; child flows get `deps` from `s.flow(…, { deps })` (fallback: parent deps).
- Ids: the type layer guarantees `next`/`dependsOn`/`timeout.next`/handler `next`/`start` ⊆ ids for literal-keyed, non-spread-overridden maps; `compile.ts` must still throw `UnknownStepId`/`DuplicateStepId` (spread override, dynamic construction, JS callers).
- Projections: exposure is exactly the `expose` spec (deny-by-default), nested via `expose.steps[k].child`; depth budget 8 (type) — the runtime should enforce the same nesting max (`maxDepth` 8 in plan §1.6).

## Consequences

- M1 implements shape (B) (`createFlow` + `FlowBuilder.steps`) with the signatures above; (A) remains available as a thin sugar only if the team accepts L2.
- `packages/core/src/authoring/types.ts` starts from §A of the spike file (delete the test sections); the spike's `@ts-expect-error` cases move to `packages/core/tests/authoring.test-d.ts` under `vitest --typecheck` (M0 exit criterion) together with the exact-error-text pin of L13.
- `packages/core/spikes/**` was deleted once the `.test-d.ts` port landed (plan §4): the cases are `packages/core/tests/types/*.test-d.ts`.

## Amendments

- **2026-08-18 — decision output is the normalized target list.** The spike typed `s.decision` as `Step<…, never, undefined, N, 'decision', never>` (`O = undefined`) while the machine stores the value returned by `next` as `step.output` (machine-spec §2/§4: `step.done{output: targets}`). Resolution (authoring review, finding 5): the machine now stores the **normalized** list (`'a'` → `['a']`, `null` → `[]`, arrays as-is) and the type says the same — `decision<N>(cfg): Step<C, Ev, D, never, readonly N[], N, 'decision', never>`, so `OutputOf<F, decision> = readonly N[]` and `StepState<F, decision>.output` no longer lies. F6's "`O = undefined` for decisions" is superseded for this kind (a `readonly N[]` sits in the same covariant/contravariant positions without the `never` problem).
- **2026-08-18 — related type-layer deltas from the same review** (mechanics unchanged, recorded for accuracy): a view's `I`/`O` infer from `input` only (`NoInfer` on `initial` and on the output-consuming hooks; without `input`, `I = never`, `O = undefined`, `initial` is rejected); `WaitOutput<Ev, T>` carries `{ event: 'timeout' }` only when the wait declares `timeout` (`T` phantom on `WaitCfg`); kind filters are `[KindOf<F,K>] extends ['view']` (a fully widened `StepKind` still counts, so `AnyFlow` keeps `string` ids); the `Checker` brand is a private `unique symbol` (`CHECKER`), not the structural `'~checker'` string; `Command<F>` is a precise union (correlated `setInput`, typed child paths, depth 8) and the untrusted door is `parseCommand(flow, unknown)`; projections keep the source `Flow` object and are deny-by-default for `output` / `issues` / `error` / `child` too, with the depth budget counting child edges (8 precise child levels).
