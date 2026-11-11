/** Constructor records and compact facts stored by a wizard. */
import type { StepKind } from './primitives'
import type { StepRecordConfig } from './step-record'

/** Anything a constructor returned (refs, needs). */
export interface StepLike {
  readonly config: StepRecordConfig
  readonly kind: StepKind
  readonly '~types': unknown
  readonly '~links': unknown
  readonly '~bound': unknown
}
/** A reference to a step: its id, or the step object itself. */
export type Ref = string | StepLike
/**
 * What a function `next` may return. Id targets keep id returns checked here (the error stays on the
 * `next` line); step objects in either list are checked by `steps()` (`Route`), which can resolve them.
 */
export type RefWithin<Tg> = [Tg] extends [never]
  ? Ref
  : [Extract<Tg, StepLike>] extends [never]
    ? Tg | StepLike
    : Ref
/** What a function `next` returns; a bare fallback to the constraint (it returns only `null`) is nothing. */
export type Returned<Nr, Tg> = [RefWithin<Tg>] extends [Nr] ? never : Nr
/** Recorded when a step object is involved, so `steps()` checks the returns against `targets`. */
export type Route<Nr, Tg> = [Extract<Nr | Tg, StepLike>] extends [never]
  ? never
  : { readonly ret: Nr; readonly tg: Tg }
/**
 * TypeScript also infers a function `next` (at low priority) into the static-ref parameter `Nx`,
 * which then falls back to its constraint `Ref | null`; that fallback means "no static next".
 */
export type StaticNext<Nx> = [Ref | null] extends [Nx] ? never : Nx

/** Per-step facts every consumer reads (`OutputOf`, `ViewId`, `RunStepId`, ). */
export interface StepFacts {
  readonly output: unknown
  readonly input?: unknown
  readonly child?: unknown
  readonly error?: unknown
  readonly runnable?: boolean
  readonly each?: boolean
}
/**
 * Facts only `steps()` reads: references, needs, successors and constructor-level problems.
 * `cond`: the step has its own `when`, so it may be skipped.
 */
export interface Links<
  Refs extends string,
  Objs,
  Needs,
  Alt,
  Succ extends boolean,
  Problem extends string,
  Cond extends boolean = false,
  Rt = never,
> {
  readonly cond: Cond
  readonly route: Rt
  readonly refs: Refs
  readonly objs: Objs
  readonly needs: Needs
  readonly alt: Alt
  readonly succ: Succ
  readonly problem: Problem
}
interface Binding<C, Ev, D> {
  readonly context: C
  readonly events: Ev
  readonly deps: D
}
/** Invariant probe for the definition facts the step was built with. */
export type BoundTo<C, Ev, D> = (facts: Binding<C, Ev, D>) => Binding<C, Ev, D>

/**
 * A constructor record with authored config and inference facts.
 * It is what `step`, `view` or `flow` returns (every field present; values are phantom).
 * `'~exact'` makes a step invariant in its facts, so `steps()` matches a `needs` ref to the map
 * entry it IS rather than to any step whose output happens to be a subtype.
 * @public
 */
export interface Step<K extends StepKind, X extends StepFacts, L, B> {
  readonly kind: K
  readonly config: StepRecordConfig
  readonly child?: X extends { readonly child: infer CF } ? CF : never
  readonly '~types': X | undefined
  readonly '~links': L | undefined
  readonly '~bound': B | undefined
  readonly '~exact': ((facts: X, links: L) => void) | undefined
}
/** Whether a step's output can be the wizard output: no successor (`sink`), maybe skipped (`maybe`). */
export type SinkRole = 'sink' | 'maybe' | 'inner'
/** Compact step facts and its sink role in the assembled wizard. @public */
export interface FlowStep<K extends StepKind, X extends StepFacts, Role extends SinkRole> {
  readonly kind: K
  readonly '~types': X | undefined
  readonly '~role': Role | undefined
}

/** A structural constraint for generic step modules and references. @public */
export type AnyStep = StepLike
