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
 * @packageDocumentation
 */

import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  Issue as MachineIssue,
  SerializedError as MachineSerializedError,
  StepStatus as MachineStepStatus,
  WizardStatus as MachineWizardStatus,
} from '../machine/state'
import type { RetryPolicy as CompiledRetryPolicy, StepKind as CompiledStepKind } from './compiled'

// ---------------------------------------------------------------------------
// Primitives shared with the machine (documented aliases so the public surface
// names them; the identity with the machine types is what matters for hooks)
// ---------------------------------------------------------------------------

/**
 * A value or a promise of it — every hook may be sync or async.
 * @public
 */
export type MaybePromise<T> = T | Promise<T>

/**
 * A duration: milliseconds as a number, or a string with a unit (`'250ms'`, `'15m'`, `'2h'`, `'1d'`).
 * @public
 */
export type Duration = number | `${number}${'ms' | 's' | 'm' | 'h' | 'd'}`

/**
 * Structural stand-in for the global `AbortSignal` (consumers need no DOM lib); the runtime passes a real one.
 * @public
 */
export interface AbortSignalLike {
  readonly aborted: boolean
  readonly reason: unknown
}

/**
 * A validation problem (Standard Schema issue shape): a message and an optional path.
 * @public
 */
export type Issue = MachineIssue

/**
 * A serializable error (`name`, `message`, optional `code`) — never carries a stack.
 * @public
 */
export type SerializedError = MachineSerializedError

/**
 * The six step kinds: `view | task | wait | decision | flow | final`.
 * @public
 */
export type StepKind = CompiledStepKind

/**
 * Stored status of a step: `idle | active | done | failed | skipped | cancelled | compensating | compensated`.
 * @public
 */
export type StepStatus = MachineStepStatus

/**
 * Status of a wizard instance: `idle | running | waiting | done | failed | compensating | cancelled`.
 * @public
 */
export type WizardStatus = MachineWizardStatus

/**
 * Retry policy for tasks (plain data, so `inspect()` shows it; the retry STATE — `attempt`, the
 * `retryAt` deadline — is what persists, the policy is read from the flow): `attempts` retries
 * after the first failure (`1` = one retry, two runs), spaced by `backoff` — a number is a fixed
 * delay in ms (absent = retry immediately); `'exponential'` waits
 * `min(baseMs × factor^(attempt-1), maxBackoffMs)` (`baseMs` 200, `factor` 2, `maxBackoffMs` 30 000).
 * @public
 */
export type RetryPolicy = CompiledRetryPolicy

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

/**
 * Runtime brand of a `Checker`. A module-private `Symbol()` (deliberately not `Symbol.for`,
 * which anyone could look up): only `boundary.parse/guard/assert/trusted` can mint a checker,
 * so a forged `{ '~checker': 'assert' }` object is never a boundary. Not exported from the
 * package; the `Checker` type is nominal through this key.
 * @internal
 */
export const CHECKER: unique symbol = Symbol('openwizard.checker')

/**
 * The four checker kinds: `parse` (return or throw), `guard` (predicate), `assert` (assertion
 * function) and `trusted` (no runtime check).
 * @public
 */
export type CheckerKind = 'parse' | 'guard' | 'assert' | 'trusted'

/**
 * A branded runtime checker built by `boundary.parse/guard/assert/trusted`. `I` is the
 * input (draft) type — equal to `O` for checkers; the (private, nominal) brand keeps plain
 * functions and hand-written objects out.
 * @public
 */
export interface Checker<O, I = O> {
  readonly [CHECKER]: CheckerKind
  readonly '~types'?: { readonly input: I; readonly output: O }
}

/**
 * A data door: any Standard Schema (Zod 4 / Valibot / ArkType / …) or a branded `Checker`.
 * `O` is the parsed output type, `I` the accepted input (draft) type.
 * @public
 */
export type Boundary<O, I = O> = StandardSchemaV1<I, O> | Checker<O, I>

/**
 * Output type of a boundary.
 * @public
 */
export type InferBoundary<B> =
  B extends StandardSchemaV1<unknown, infer O> ? O : B extends Checker<infer O, unknown> ? O : never

/**
 * Input (draft) type of a boundary.
 * @public
 */
export type InferBoundaryInput<B> =
  B extends StandardSchemaV1<infer I, unknown> ? I : B extends Checker<unknown, infer I> ? I : never

// ---------------------------------------------------------------------------
// Step ids
// ---------------------------------------------------------------------------

/**
 * String keys of a steps map.
 * @public
 */
export type Ids<T> = Extract<keyof T, string>

/**
 * A `next` target: one id, several ids (fan-out) or `null` (no successor).
 * @public
 */
export type NextRef<N extends string> = N | readonly N[] | null

/**
 * Data-readiness dependencies: every listed step must be done (`readonly N[]`) or any of them (`{ any }`).
 * @public
 */
export type DependsOn<N extends string> = readonly N[] | { readonly any: readonly N[] }

// ---------------------------------------------------------------------------
// Hook arguments
// ---------------------------------------------------------------------------

/**
 * Sibling step state as seen from inside a hook. LIMITATION (ADR-001 L1): a constructor
 * runs before its siblings exist, so this map cannot be typed per flow — it is an open map
 * of unknown input/output. Cross-step data should travel through `context` (typed) instead.
 * @public
 */
export interface SiblingState<I = unknown, O = unknown> {
  readonly kind: StepKind
  readonly status: StepStatus
  readonly attempt: number
  readonly input?: I
  readonly output?: O
  readonly issues?: readonly Issue[]
  readonly error?: SerializedError
}

/**
 * The open sibling map handed to hooks (`args.steps`).
 * @public
 */
export type SiblingStates = { readonly [id: string]: SiblingState }

/**
 * Arguments every hook receives.
 * @public
 */
export interface BaseArgs<C, D> {
  readonly context: C
  /** Patch the flow context (recorded as `context.changed`). */
  readonly update: (patch: Partial<C>) => void
  readonly deps: D
  readonly steps: SiblingStates
  readonly step: string
  /** Wizard path (`[]` for the root, `['fulfil']` inside a child flow). */
  readonly path: readonly string[]
  readonly signal: AbortSignalLike
}
/**
 * `run` hook arguments (`attempt` is 1-based).
 * @public
 */
export interface RunArgs<C, D> extends BaseArgs<C, D> {
  readonly attempt: number
}
/**
 * `enter` / `canEnter` hook arguments.
 * @public
 */
export interface EnterArgs<C, D> extends BaseArgs<C, D> {
  readonly from: string | null
}
/**
 * Hook arguments carrying the step's output (`validate`, `canExit`, `next`).
 * @public
 */
export interface OutputArgs<C, D, O> extends BaseArgs<C, D> {
  readonly output: O
}
/**
 * `exit` hook arguments.
 * @public
 */
export interface ExitArgs<C, D, O> extends OutputArgs<C, D, O> {
  readonly to: string | null
  readonly direction: 'forward' | 'back'
}
/**
 * `compensate` hook arguments.
 * @public
 */
export interface CompensateArgs<C, D, O> extends OutputArgs<C, D, O> {
  readonly reason: string | undefined
}
/**
 * `wait.on[event]` handler arguments.
 * @public
 */
export interface EventArgs<C, D, P, E> extends BaseArgs<C, D> {
  readonly event: E
  readonly payload: P
}
/**
 * `next` hook arguments (the step's output is available).
 * @public
 */
export type NextArgs<C, D, O> = OutputArgs<C, D, O>

/**
 * A `next` specification: a static target (id / ids / null) or a function of the step's output.
 * @public
 */
export type NextSpec<C, D, O, N extends string> =
  | NextRef<N>
  | ((a: NextArgs<C, D, O>) => MaybePromise<NextRef<N>>)

/**
 * Output of a wait step: the resolving `{ event, payload }` (union over every flow event),
 * plus `{ event: 'timeout' }` when the step declares a `timeout` (`T` is the phantom captured
 * from `WaitCfg.timeout`: `undefined` when the step declares none; the default `unknown` keeps
 * the marker, i.e. "any wait step").
 * @public
 */
export type WaitOutput<Ev, T = unknown> =
  | { [E in keyof Ev]: { readonly event: E; readonly payload: Ev[E] } }[keyof Ev]
  | ([T] extends [undefined] ? never : { readonly event: 'timeout' })

/**
 * `wait.on` handlers, one per event the step listens for. A handler may return
 * `{ next }` to override the step's static `next` (a single id; `null`/`undefined` = no override).
 * @public
 */
export type OnHandlers<C, Ev, D, N extends string> = {
  readonly [E in keyof Ev]?: (
    a: EventArgs<C, D, Ev[E], E>,
  ) => MaybePromise<void | undefined | { readonly next?: N | null | undefined }>
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/**
 * Phantom facts of a step: input (draft) type, output type, referenced ids and child flow.
 * @public
 */
export interface StepTypes<I, O, N extends string, CF> {
  readonly input: I
  readonly output: O
  readonly refs: N
  readonly child: CF
}

/**
 * Contravariant probe that records which context / events / deps a step is bound to; the
 * assembly check `T[K] extends { '~bound': BoundTo<C, Ev, D> | undefined }` accepts steps
 * written for a subset context / events / deps and rejects unrelated ones. Phantom only.
 * @public
 */
export type BoundTo<C, Ev, D> = (args: BaseArgs<C, D>, events: Ev) => void

/**
 * One step as returned by a constructor. `C` context, `Ev` event map, `D` deps, `I` raw input
 * (draft) type, `O` output type, `N` every step id literal this step references (phantom),
 * `K` kind, `CF` child flow. Every config field is present (`undefined` when unset).
 * @public
 */
export interface Step<C, Ev, D, I, O, N extends string, K extends StepKind, CF> {
  readonly kind: K
  readonly '~types': StepTypes<I, O, N, CF> | undefined
  readonly '~bound': BoundTo<C, Ev, D> | undefined
  readonly label: string | undefined
  readonly dependsOn: DependsOn<N> | undefined
  readonly next: NextSpec<C, D, O, N> | undefined
  // view
  readonly input: Boundary<O, I> | undefined
  readonly initial: Partial<I> | undefined
  readonly validate:
    | ((a: OutputArgs<C, D, O>) => MaybePromise<void | undefined | readonly Issue[]>)
    | undefined
  readonly canEnter: ((a: EnterArgs<C, D>) => MaybePromise<boolean>) | undefined
  readonly canExit: ((a: OutputArgs<C, D, O>) => MaybePromise<boolean>) | undefined
  readonly enter: ((a: EnterArgs<C, D>) => unknown) | undefined
  readonly exit: ((a: ExitArgs<C, D, O>) => unknown) | undefined
  // task
  readonly run: ((a: RunArgs<C, D>) => unknown) | undefined
  readonly output: Boundary<O, unknown> | ((a: BaseArgs<C, D>) => O) | undefined
  readonly retry: RetryPolicy | undefined
  readonly timeout: Duration | { readonly after: Duration; readonly next: N } | undefined
  readonly compensate: ((a: CompensateArgs<C, D, O>) => unknown) | undefined
  // wait
  readonly on: OnHandlers<C, Ev, D, N> | undefined
  // flow
  readonly child: CF | undefined
  readonly context: ((a: BaseArgs<C, D>) => unknown) | undefined
  readonly deps: ((a: BaseArgs<C, D>) => unknown) | undefined
}

/**
 * Untyped view of any step record — the runtime's internal shape (never exported from the barrel).
 * @internal
 */
// biome-ignore lint/suspicious/noExplicitAny: internal wildcard view used only by the runtime
export type AnyStep = Step<any, any, any, any, any, string, StepKind, any>

/**
 * What `Flow.steps[k]` is typed as: the per-step facts only (kind + phantom). `C`/`Ev`/`D` are
 * NOT repeated per step so a flow's printed type stays O(steps); every extractor reads only
 * `kind` and `'~types'`.
 * @public
 */
export interface FlowStep<I, O, N extends string, K extends StepKind, CF> {
  readonly kind: K
  readonly '~types': StepTypes<I, O, N, CF> | undefined
}

/**
 * Compacts a constructor result to its `FlowStep`.
 * @public
 */
export type CompactStep<S> = S extends {
  readonly kind: infer K extends StepKind
  readonly '~types': StepTypes<infer I, infer O, infer N, infer CF> | undefined
}
  ? FlowStep<I, O, N, K, CF>
  : never

// ---------------------------------------------------------------------------
// Per-kind constructor configs (concrete object types → excess-property checks work)
// ---------------------------------------------------------------------------

/**
 * `s.view` configuration. `I` / `O` are inferred from `input` ONLY (`NoInfer` everywhere else):
 * without `input` the view has no draft (`I = never`, `O = undefined`) and `initial` is rejected.
 * @public
 */
export interface ViewCfg<C, D, I, O, N extends string> {
  readonly label?: string
  /** Boundary for the draft input; the OUTPUT side is what hooks and `steps[k].output` see. */
  readonly input?: Boundary<O, I>
  /** Initial draft (INPUT side, partial). Requires `input`. */
  readonly initial?: NoInfer<Partial<I>>
  readonly validate?: (
    a: OutputArgs<C, D, NoInfer<O>>,
  ) => MaybePromise<void | undefined | readonly Issue[]>
  readonly canEnter?: (a: EnterArgs<C, D>) => MaybePromise<boolean>
  readonly canExit?: (a: OutputArgs<C, D, NoInfer<O>>) => MaybePromise<boolean>
  readonly enter?: (a: EnterArgs<C, D>) => unknown
  readonly exit?: (a: ExitArgs<C, D, NoInfer<O>>) => unknown
  readonly next?: NextSpec<C, D, NoInfer<O>, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.task(run, options)` options.
 * @public
 */
export interface TaskOptions<C, D, O, N extends string> {
  readonly label?: string
  /** Optional re-check of the value returned by `run` (fixes the step's output type). */
  readonly output?: Boundary<O, unknown>
  readonly retry?: RetryPolicy
  readonly timeout?: Duration
  readonly compensate?: (a: CompensateArgs<C, D, O>) => unknown
  readonly enter?: (a: EnterArgs<C, D>) => unknown
  readonly exit?: (a: ExitArgs<C, D, O>) => unknown
  readonly next?: NextSpec<C, D, O, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.wait` configuration. `T` is the phantom captured from `timeout` (`undefined` when absent)
 * that decides whether `WaitOutput` carries the `{ event: 'timeout' }` marker.
 * @public
 */
export interface WaitCfg<C, Ev, D, N extends string, T = unknown> {
  readonly label?: string
  readonly on: OnHandlers<C, Ev, D, N>
  readonly timeout?: { readonly after: Duration; readonly next: N } & T
  readonly enter?: (a: EnterArgs<C, D>) => unknown
  readonly exit?: (a: ExitArgs<C, D, WaitOutput<Ev, T>>) => unknown
  readonly next?: NextSpec<C, D, WaitOutput<Ev, T>, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.decision` configuration. The step's output is the normalized list of chosen targets
 * (`readonly N[]`: `'a'` → `['a']`, `null` → `[]`).
 * @public
 */
export interface DecisionCfg<C, D, N extends string> {
  readonly label?: string
  readonly next: (a: NextArgs<C, D, undefined>) => MaybePromise<NextRef<N>>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.flow(child, cfg)` configuration.
 * @public
 */
export interface FlowCfg<C, D, CF extends AnyFlow, O, N extends string> {
  readonly label?: string
  /** Builds the child's context input (parsed ONCE by the child's context boundary at child creation). */
  readonly context: (a: BaseArgs<C, D>) => ContextInput<CF>
  /**
   * Builds the child's deps (parsed by the child's `deps` boundary when it declares one, at
   * child creation); when omitted the parent's deps object is passed through unchanged.
   */
  readonly deps?: (a: BaseArgs<C, D>) => DepsOf<CF>
  /** Optional re-check of the child's output (fixes the step's output type). */
  readonly output?: Boundary<O, unknown>
  readonly exit?: (a: ExitArgs<C, D, O>) => unknown
  readonly next?: NextSpec<C, D, O, N>
  readonly dependsOn?: DependsOn<N>
}
/**
 * `s.final` configuration.
 * @public
 */
export interface FinalCfg<C, D, O> {
  readonly label?: string
  readonly output?: (a: BaseArgs<C, D>) => O
}

/**
 * Constructors pre-bound to `C`/`Ev`/`D`. Only `N` captures literals; no `const` params.
 * `I = never` means "this step has no draft input"; `O` is `undefined` (never `never`) when a
 * step has no output value. A view's `I`/`O` come from its `input` boundary only; a wait's
 * `T` phantom records whether it declares a `timeout`; a decision's output is `readonly N[]`.
 * @public
 */
export interface StepApi<C, Ev, D> {
  view<I = never, O = [I] extends [never] ? undefined : I, N extends string = never>(
    cfg: ViewCfg<C, D, I, O, N>,
  ): Step<C, Ev, D, I, O, N, 'view', never>
  task<R, O = Awaited<R>, N extends string = never>(
    run: (a: RunArgs<C, D>) => R,
    options?: TaskOptions<C, D, O, N>,
  ): Step<C, Ev, D, never, O, N, 'task', never>
  wait<N extends string = never, T = undefined>(
    cfg: WaitCfg<C, Ev, D, N, T>,
  ): Step<
    C,
    Ev,
    D,
    never,
    WaitOutput<Ev, [T] extends [undefined] ? undefined : true>,
    N,
    'wait',
    never
  >
  decision<N extends string>(
    cfg: DecisionCfg<C, D, N>,
  ): Step<C, Ev, D, never, readonly N[], N, 'decision', never>
  flow<CF extends AnyFlow, O = FlowOutput<CF>, N extends string = never>(
    child: CF,
    cfg: FlowCfg<C, D, CF, O, N>,
  ): Step<C, Ev, D, never, O, N, 'flow', CF>
  final<O = undefined>(cfg?: FinalCfg<C, D, O>): Step<C, Ev, D, never, O, never, 'final', never>
}

// ---------------------------------------------------------------------------
// Assembly-time validation
// ---------------------------------------------------------------------------

/**
 * Ids a step references (phantom `refs`).
 * @public
 */
export type RefsOf<S> = S extends { readonly '~types': infer P }
  ? NonNullable<P> extends { readonly refs: infer R }
    ? R
    : never
  : never

/**
 * `T & ValidateSteps<T, C, Ev, D>`: naked `T` wins inference; a failing key evaluates to an
 * object with a `'~error'` message property that no Step has, so the error lands on that
 * step's property line and never cascades into `T`. The `'~bound'` probe checks that every
 * step is bound to this flow's context/events/deps (module variance).
 *
 * IMPORTANT (ADR-001 F1): `T` must NOT be constrained; the homomorphic mapped type below has no
 * visible members while `T` is generic, so it cannot poison inference.
 * @public
 */
export type ValidateSteps<T, C, Ev, D> = {
  readonly [K in keyof T]: [RefsOf<T[K]>] extends [Ids<T>]
    ? T[K] extends { readonly '~bound': BoundTo<C, Ev, D> | undefined }
      ? unknown
      : {
          readonly '~error': `step '${K & string}' is bound to a different context/events/deps than this flow`
        }
    : {
        readonly '~error': `step '${K & string}' references unknown step id(s): '${Exclude<RefsOf<T[K]>, Ids<T>> & string}'`
      }
}
/**
 * Rejects steps maps with dynamic (index-signature) keys — every id must be a literal.
 * @public
 */
export type NoDynamicKeys<T> = string extends keyof T
  ? { readonly '~error': 'steps must be declared with literal keys' }
  : unknown
/**
 * The full assembly check applied by `FlowBuilder.steps`.
 * @public
 */
export type CheckSteps<T, C, Ev, D> = ValidateSteps<T, C, Ev, D> & NoDynamicKeys<T>

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

/**
 * Phantom facts of a flow.
 * @public
 */
export interface FlowTypes<C, CIn, Ev, D, T> {
  readonly ctx: C
  readonly ctxIn: CIn
  readonly events: Ev
  readonly deps: D
  readonly steps: T
}

/**
 * Flow-level policies.
 * @public
 */
export interface FlowOptions {
  /** What happens when a task fails with no retries left. Default `'halt'`. */
  readonly onFailure?: 'halt' | 'compensate'
  /** Default retry policy for tasks. */
  readonly retry?: RetryPolicy
  /** Ready non-view steps start automatically (`'ready'`, default) or via `runReady()` (`'manual'`). */
  readonly autoRun?: 'ready' | 'manual'
  /** Maximum concurrently running tasks. Default `Infinity`. */
  readonly concurrency?: number
  /** Events with no active listener: buffer them (default `true`) for `ttl` (default `'5m'`). */
  readonly unmatchedEvents?: { readonly buffer: boolean; readonly ttl: Duration }
}

/**
 * A defined flow. `T` is the COMPACT steps map (`{ [id]: FlowStep<…> }`); the runtime object
 * holds the full step records (with hooks).
 * @public
 */
export interface Flow<C, CIn, Ev, D, T> extends FlowOptions {
  readonly '~types': FlowTypes<C, CIn, Ev, D, T> | undefined
  readonly name: string
  readonly version?: number
  readonly context: Boundary<C, CIn>
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown> }
  readonly deps?: Boundary<D, unknown>
  readonly steps: T
  readonly start?: Ids<T>
}

/**
 * The steps map every flow satisfies (an index of `FlowStep`s); the interface breaks the
 * `AnyFlow` ↔ child-flow reference cycle.
 * @public
 */
export interface AnyFlowSteps {
  readonly [id: string]: FlowStep<unknown, unknown, string, StepKind, AnyFlow>
}

/**
 * Any flow — the constraint of every extractor and of `Wizard<F>`; `any`-free (a flow's
 * `'~types'`/`steps`/boundaries are covariant, so every concrete `Flow` is assignable).
 * @public
 */
export type AnyFlow = Flow<unknown, unknown, Record<string, unknown>, unknown, AnyFlowSteps>

/**
 * `defineFlow(options)` header: name/version, boundaries and policies.
 * @public
 */
export type FlowDefinition<C, CIn, Ev, D> = FlowOptions & {
  /** Persistence identity together with `version`. Required. */
  readonly name: string
  readonly version?: number
  /** Context boundary (`boundary.trusted<C>()` for unvalidated defaults). */
  readonly context: Boundary<C, CIn>
  /** External event boundaries; `Ev` is inferred by reverse mapping. */
  readonly events?: { readonly [E in keyof Ev]: Boundary<Ev[E], unknown> }
  /** Injected dependencies boundary (usually `boundary.trusted<D>()`). */
  readonly deps?: Boundary<D, unknown>
}

/**
 * What `defineFlow(options)` returns: the pre-bound constructors plus `steps()`.
 * @public
 */
export interface FlowBuilder<C, CIn, Ev, D> extends StepApi<C, Ev, D> {
  /**
   * Assemble the flow. `start` defaults to the first declared step. Every referenced id is
   * checked at compile time (`'~error'` on the offending step property) and at runtime.
   */
  steps<T>(
    steps: T & CheckSteps<T, C, Ev, D>,
    opts?: { readonly start?: NoInfer<Ids<T>> },
  ): Flow<C, CIn, Ev, D, { readonly [K in keyof T]: CompactStep<T[K]> }>
}

// ---------------------------------------------------------------------------
// Extractors (one per concept; indexed access on '~types', no distribution)
// ---------------------------------------------------------------------------

/**
 * Parsed context type of a flow (boundary OUTPUT side).
 * @public
 */
export type Ctx<F extends AnyFlow> = NonNullable<F['~types']>['ctx']
/**
 * Context input type of a flow (boundary INPUT side — what `createWizard` accepts).
 * @public
 */
export type ContextInput<F extends AnyFlow> = NonNullable<F['~types']>['ctxIn']
/**
 * Deps type of a flow (`unknown` when the flow declares no `deps` boundary).
 * @public
 */
export type DepsOf<F extends AnyFlow> = NonNullable<F['~types']>['deps']
/**
 * Event map of a flow (`{ [event]: payload }`).
 * @public
 */
export type EventMapOf<F extends AnyFlow> = NonNullable<F['~types']>['events']
/**
 * Declared event names of a flow.
 * @public
 */
export type EventType<F extends AnyFlow> = Extract<keyof EventMapOf<F>, string>
/**
 * Parsed payload type of one event.
 * @public
 */
export type PayloadOf<F extends AnyFlow, E extends EventType<F>> = EventMapOf<F>[E]
/**
 * Step ids of a flow.
 * @public
 */
export type StepId<F extends AnyFlow> = Extract<keyof F['steps'], string>
/**
 * Phantom facts of one step.
 * @public
 */
export type StepTypesOf<F extends AnyFlow, K extends StepId<F>> = NonNullable<
  F['steps'][K]['~types']
>
/**
 * Raw input (draft, INPUT side of the view's `input` boundary) type of a step; `never` without a draft.
 * @public
 */
export type InputOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['input']
/**
 * Draft patch type of a view (`Partial` of the INPUT side) — what `setInput` accepts.
 * @public
 */
export type DraftOf<F extends AnyFlow, K extends StepId<F>> = Partial<InputOf<F, K>>
/**
 * Output type of a step: parsed input (view), run result (task), `{ event, payload }` (wait),
 * child output (flow), `output()` result (final); `undefined` when the step has none.
 * @public
 */
export type OutputOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['output']
/**
 * Child flow of a `flow` step (`never` for other kinds).
 * @public
 */
export type ChildFlowOf<F extends AnyFlow, K extends StepId<F>> = StepTypesOf<F, K>['child']
/**
 * Kind of a step.
 * @public
 */
export type KindOf<F extends AnyFlow, K extends StepId<F>> = F['steps'][K]['kind']
/**
 * `true` when step `K` is exactly of kind `Kind` — or when its kind is the fully widened
 * `StepKind` (a wildcard flow such as `AnyFlow`, where every id is a `string` anyway). A step
 * whose kind is a partial union (`'view' | 'task'`) is NOT of either kind (safe direction).
 * @public
 */
export type HasKind<F extends AnyFlow, K extends StepId<F>, Kind extends StepKind> = [
  KindOf<F, K>,
] extends [Kind]
  ? true
  : [StepKind] extends [KindOf<F, K>]
    ? true
    : false
/**
 * Ids of the view steps (`go`, `setInput`, `resetInput`, `validate` accept these).
 * @public
 */
export type ViewId<F extends AnyFlow> = {
  [K in StepId<F>]: HasKind<F, K, 'view'> extends true ? K : never
}[StepId<F>]
/**
 * Ids of the task steps (`retry`, `run` accept these).
 * @public
 */
export type TaskId<F extends AnyFlow> = {
  [K in StepId<F>]: HasKind<F, K, 'task'> extends true ? K : never
}[StepId<F>]
/**
 * Ids of the `flow` steps (`child()` accepts these).
 * @public
 */
export type ChildStepId<F extends AnyFlow> = {
  [K in StepId<F>]: [ChildFlowOf<F, K>] extends [never] ? never : K
}[StepId<F>]
/**
 * Output type of a flow: the union of its `final` steps' outputs.
 * @public
 */
export type FlowOutput<F extends AnyFlow> = {
  [K in StepId<F>]: HasKind<F, K, 'final'> extends true ? OutputOf<F, K> : never
}[StepId<F>]
