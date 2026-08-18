/**
 * Authoring type layer — the port of the M0 spike that won ADR-001 (shape B:
 * `defineFlow(options)` returns a `FlowBuilder` of pre-bound constructors, and
 * `.steps(defs, { start })` assembles the inert `Flow`).
 *
 * Mechanics that must not change without re-running the ADR gates:
 * - constructors are pre-bound to `C`/`Ev`/`D`; only `N` (referenced ids) captures literals;
 * - `steps<T>(steps: T & CheckSteps<T, C, Ev, D>)` — `T` is deliberately unconstrained
 *   (a `Record<string, AnyStep>` constraint poisons inference, ADR-001 F1);
 * - `Step` fields are required-or-`undefined` (never optional) so the id error reads
 *   "Property '~error' is missing" instead of the misleading TS2375 wording (F5/L13);
 * - `Flow.steps` is typed compactly (`FlowStep` = kind + phantom) so hover/.d.ts stay O(steps) (F7);
 * - `I = never` for steps without a draft input, `O = undefined` for steps without an output (F6);
 * - one extractor per concept, all indexed accesses on `'~types'` (no distributive conditionals).
 *
 * Deviations from the spike (each reported in the M1 report): step-level `expose` is gone
 * (projections are deny-by-default and decide exposure); the flow-binding check uses the
 * contravariant `'~bound'` probe instead of `T[K] extends AnyStep<C, Ev, D>` so nothing in
 * the public surface carries `any`; `AnyFlow` is `any`-free for the same reason; a wait
 * step's output includes `{ event: 'timeout' }` only when the step declares `timeout` (the
 * `T` phantom of `WaitCfg`); a wait handler's `next` override is a single id (what the machine
 * supports); a decision's output is the normalized target list (`readonly N[]`, ADR-001
 * amendment 2026-08-18); a view's `I`/`O` infer from its `input` boundary ONLY (`NoInfer` on
 * `initial` and on every output-consuming hook), so a view without `input` is `I = never`,
 * `O = undefined` and rejects `initial`.
 *
 * v0.2 additions (plan §9, ADR-001 amendments): `on` handlers on every kind with a per-kind
 * return contract (`WaitOnResult` / `ViewOnResult` / `void`), flow-level `on` and `correlate`
 * on the definition header (`NoInfer` there so they never feed `Ev` inference), `when` on
 * every non-final kind, `idempotent` / `mapError` on tasks, and a fifth phantom `E` (the
 * `mapError` value type, `ErrorOf<F, K>`) as a trailing default parameter of `StepTypes` /
 * `Step` / `FlowStep` so existing hand-written types keep compiling.
 *
 * @packageDocumentation
 */

export * from './boundary'
export * from './extractors'
export * from './flow'
export * from './handlers'
export * from './hook-args'
export * from './primitives'
export * from './step'
export * from './step-config'
