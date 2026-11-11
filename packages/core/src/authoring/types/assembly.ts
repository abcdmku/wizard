/** Validate refs only after the real steps map exists. */
import type { BoundTo, FlowStep, Links, SinkRole, Step, StepLike } from './step'
import type { NeedStep, NeedSteps } from './step-inference'

export type StepError<M> = { readonly [P in M & string]: never }
type LinksOf<S> = S extends { readonly '~links': infer L } ? NonNullable<L> : never
type LinkFact<S, F extends 'needs' | 'alt' | 'succ' | 'cond'> =
  LinksOf<S> extends infer L ? (F extends keyof L ? L[F] : never) : never
type Quoted<X> = X extends string ? `'${X}'` : never
type EmptyAny<Nd> = {
  [A in keyof Nd]: Nd[A] extends { readonly any: readonly never[] } ? A : never
}[keyof Nd]
type IdNeeds<Nd> = { [A in keyof Nd]: Nd[A] extends string ? A : never }[keyof Nd]
type ForeignNeeds<T, Nd> = {
  [A in keyof Nd]: Nd[A] extends string ? never : [NeedStep<Nd[A]>] extends [T[keyof T]] ? never : A
}[keyof Nd]
type ForeignProblem<T, K extends string, Nd> = [IdNeeds<Nd>] extends [never]
  ? ForeignStep<T, K, Nd>
  : `step '${K}': need ${Quoted<IdNeeds<Nd> & string>} must be a step object (const x = step(...)), not an id`
type ForeignStep<T, K extends string, Nd> = [ForeignNeeds<T, Nd>] extends [never]
  ? `step '${K}' references a step object that is not part of this steps() map`
  : `step '${K}' needs ${Quoted<ForeignNeeds<T, Nd> & string>}, which is not a step of this wizard (declare it in this steps() map, built with this wizard's api)`
type KeysOf<T, O> = { [K in keyof T]: [T[K]] extends [O] ? K : never }[keyof T]
type EscapedIds<T, Rt> = Rt extends { readonly ret: infer R; readonly tg: infer G }
  ? [Extract<R, string>] extends [never]
    ? never
    : Exclude<Extract<R, string>, Extract<G, string> | KeysOf<T, Extract<G, StepLike>>>
  : never
type EscapedObjs<T, Rt> = Rt extends { readonly ret: infer R; readonly tg: infer G }
  ? [Extract<R, StepLike>] extends [Extract<G, StepLike> | T[Extract<G, string> & keyof T]]
    ? never
    : true
  : never
type RouteProblem<T, K extends string, Rt> = [EscapedIds<T, Rt>] extends [never]
  ? [EscapedObjs<T, Rt>] extends [never]
    ? never
    : `step '${K}': next may return a step object that is not in targets`
  : `step '${K}': next may return ${Quoted<EscapedIds<T, Rt>>}, which is not in targets`
type LinkProblem<T, K extends string, L> =
  L extends Links<infer Refs, infer Objs, infer Nd, infer _A, infer _S, infer P, infer _W, infer Rt>
    ? [P] extends [never]
      ? string extends Refs
        ? `step '${K}' references an id typed as plain string; use a literal id or the step object`
        : [Exclude<Refs, keyof T>] extends [never]
          ? [Objs | NeedSteps<Nd>] extends [T[keyof T]]
            ? [EmptyAny<Nd>] extends [never]
              ? RouteProblem<T, K, Rt>
              : `step '${K}': need ${Quoted<EmptyAny<Nd> & string>} lists no steps (\`any\` needs at least one)`
            : ForeignProblem<T, K, Nd>
          : `step '${K}' references unknown step id ${Quoted<Exclude<Refs, keyof T>>}`
      : `step '${K}': ${P}`
    : never
type StepProblem<T, K extends string, C, Ev, D> = T[K & keyof T] extends {
  readonly '~links': infer L
  readonly '~bound': infer B
}
  ? [B] extends [BoundTo<C, Ev, D> | undefined]
    ? LinkProblem<T, K, NonNullable<L>>
    : `step '${K}' is bound to a different context/events/deps than this wizard`
  : `'${K}' is not a step: create it with step(), view() or flow()`
/** Each invalid property gets an error whose first key is the diagnostic message. */
export type CheckSteps<T, C, Ev, D> = {
  readonly [K in keyof T]: StepProblem<T, K & string, C, Ev, D> extends infer P
    ? [P] extends [never]
      ? T[K]
      : StepError<P>
    : never
} & (string extends keyof T ? StepError<'steps must be declared with literal keys'> : unknown) &
  ([keyof T] extends [never] ? StepError<'a wizard needs at least one step'> : unknown)

type AllAlts<T> = { [K in keyof T]: LinkFact<T[K], 'alt'> }[keyof T]
/**
 * `inner`: has a successor or is pulled by a `needs`. Steps are matched by type, so a needed step
 * with an identical twin in the map stays a (maybe-skipped) sink rather than risk dropping an output.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type KeyedOf<T, Nd> = {
  [A in keyof Nd]: A extends keyof T ? (Same<Nd[A], T[A]> extends true ? A : never) : never
}[keyof Nd]
type LooseOf<T, Nd> = {
  [A in keyof Nd]: A extends keyof T
    ? Same<Nd[A], T[A]> extends true
      ? never
      : NeedStep<Nd[A]>
    : NeedStep<Nd[A]>
}[keyof Nd]
/** Keys pulled by a shorthand need (`needs: { a }`): the alias is the id and the step matches. */
type KeyedNeeds<T> = { [K in keyof T]: KeyedOf<T, LinkFact<T[K], 'needs'>> }[keyof T]
/** Needs matched only by type (renamed alias, `any`, `optional`). */
type LooseNeeds<T> = { [K in keyof T]: LooseOf<T, LinkFact<T[K], 'needs'>> }[keyof T]
type Leaves<T> = { [K in keyof T]: LinkFact<T[K], 'succ'> extends true ? never : K }[keyof T]
/**
 * Any `when`, target, fallback or timeout edge can skip steps downstream; until a bounded
 * "surely runs" pass exists, every sink of such a map may be skipped (types never drop `undefined`).
 */
type HasBranches<T> = true extends { [K in keyof T]: LinkFact<T[K], 'cond'> }[keyof T]
  ? true
  : [AllAlts<T>] extends [never]
    ? false
    : true
export type RoleOf<T, K extends keyof T> =
  LinkFact<T[K], 'succ'> extends true
    ? 'inner'
    : K extends KeyedNeeds<T>
      ? 'inner'
      : [T[K]] extends [LooseNeeds<T>]
        ? [T[K]] extends [T[Exclude<Leaves<T>, K>]]
          ? 'maybe'
          : 'inner'
        : HasBranches<T> extends true
          ? 'maybe'
          : 'sink'
export type CompactStep<S, Role extends SinkRole> =
  S extends Step<infer K, infer X, infer _L, infer _B> ? FlowStep<K, X, Role> : never
