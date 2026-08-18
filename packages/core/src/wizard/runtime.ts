/**
 * Untyped wizard runtime — the live object behind the typed `Wizard<F>` façade
 * (`createWizard`/`resumeWizard` in the authoring layer wrap it).
 *
 * Every method is sugar over `dispatch(command)`; results are values (plan
 * §8.2): `CommandResult`, `NavResult`, `SendResult`. `WizardError` is the
 * rejection only for misuse: `DISPOSED`, `UNKNOWN_EVENT`, `UNKNOWN_STEP`
 * (validate), and `NOT_A_FLOW_STEP` / `NOT_ACTIVE` are thrown by `child()`.
 *
 * Sync-commit guarantee (plan §8.1): every public call enqueues its command
 * synchronously; when the whole chain (boundary, hooks, machine) is
 * synchronous, the state is committed and listeners are notified before the
 * call returns and the returned promise is *already fulfilled* — no `async`
 * wrappers, no gratuitous microtask hops. Only genuinely asynchronous work
 * (a thenable from a boundary/hook, a transaction waiting for a hook result)
 * yields a pending promise, and every such promise is settled by `dispose()`.
 *
 * Promise settlement: a command's promise resolves when the batch produced by
 * that command commits; navigation commands wait for their transaction
 * (`transition.committed/rejected/failed`; the machine's `settle` effect is
 * honoured as a fallback). Nothing here re-enters the machine: everything —
 * including `child` commands (`child.command` → `child.send`) — flows through
 * the interpreter queue.
 *
 * @internal Public users see the typed `Wizard<F>`.
 */

import type { CompiledFlow } from '../authoring/compiled'
import { WizardError, type WizardErrorCode } from '../errors'
import type { ChildFactory } from '../interpreter/child'
import {
  type Clock,
  createIdGenerator,
  createRealClock,
  createRealScheduler,
  type IdGenerator,
  type RuntimeEnv,
  type Scheduler,
} from '../interpreter/env'
import { buildHookArgs } from '../interpreter/executor'
import { createInterpreter, type Interpreter } from '../interpreter/interpreter'
import { getThen } from '../interpreter/thenable'
import { type Explanation, explain } from '../machine'
import type { Command, Message } from '../machine/commands'
import type { Effect } from '../machine/effects'
import type { DomainEvent, TransitionRejectReason } from '../machine/events'
import type { Issue, SerializedError, WizardState } from '../machine/state'
import type { InitialState, Machine, MachineEnv } from '../machine/types'
import { createPersistenceDriver, type PersistenceDriver } from '../persistence/driver'
import { canReviveAt } from '../persistence/revivable'
import type { Store } from '../persistence/store'
import { decodeCommand } from './parse-command'
import type { CommandResult, NavResult, SendResult } from './results'
import { type Snapshot, toSnapshot } from './snapshot'

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export interface WizardRuntimeOptions {
  /** Context value that already passed the flow's context boundary. */
  readonly context: unknown
  /** Injected dependencies (already through `def.deps`, if declared); `args.deps` in hooks. */
  readonly deps?: unknown
  readonly instanceId?: string
  /** The pure machine (`decide/apply/plan`) and its initial-state builder. */
  readonly machine: Machine
  readonly initialState: InitialState
  readonly store?: Store
  /** Store key; defaults to the instance id. */
  readonly key?: string
  /** Default `'change'` when a store is given. */
  readonly autoSave?: 'change' | 'off'
  /** Coalesce auto-saves (ms). Default 0 = write after each drain that changed state. */
  readonly debounceMs?: number
  /** Applied to the snapshot right before `store.set`. */
  readonly redact?: (snapshot: Snapshot) => unknown
  /** Delete the key instead of writing once the flow is `done`. */
  readonly clearOnDone?: boolean
  /** Store failures on the auto-save path. Default: rethrown asynchronously. */
  readonly onPersistError?: (error: unknown) => void
  readonly clock?: Clock
  /** A `TestScheduler` passed here without `clock` is used as the clock too. */
  readonly scheduler?: Scheduler
  readonly ids?: IdGenerator
  /** Turn the first thenable returned by a hook into a `SYNC_VIOLATION` failure. */
  readonly strict?: 'sync'
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number
  /** Grace period before an aborted, unsettled hook is reported (ms). Default 30 s. */
  readonly abortGraceMs?: number
  /** Listener exceptions are isolated; default rethrows asynchronously. */
  readonly onListenerError?: (error: unknown) => void
}

export type ResumeWizardRuntimeOptions = Omit<WizardRuntimeOptions, 'context' | 'instanceId'>

export interface WizardRuntime {
  readonly id: string
  readonly path: readonly string[]
  /** Increments on every resume; Mirrors use `(epoch, seq)` to order frames. */
  readonly epoch: number
  start(): Promise<CommandResult>
  next(): Promise<NavResult>
  back(): Promise<NavResult>
  go(step: string): Promise<NavResult>
  setInput(step: string, patch: unknown): Promise<CommandResult>
  resetInput(step: string): Promise<CommandResult>
  /** Pure query: the view's `input` boundary + `validate` hook over the current draft; no events. */
  validate(step: string): Promise<readonly Issue[]>
  /** External event through the flow's event boundary. Unknown event name → `WizardError('UNKNOWN_EVENT')`. */
  send(
    event: string,
    payload: unknown,
    options?: { readonly correlationId?: string },
  ): Promise<SendResult>
  run(step: string): Promise<CommandResult>
  retry(step: string): Promise<CommandResult>
  cancel(reason?: string): Promise<CommandResult>
  runReady(): Promise<CommandResult>
  compensate(options?: { readonly from?: string; readonly reason?: string }): Promise<CommandResult>
  reset(): Promise<CommandResult>
  /** The one wire door: validates the shape (`decodeCommand`) and never throws for data problems. */
  dispatch(command: Command): Promise<CommandResult>
  getState(): WizardState
  /** Versioned, JSON-safe snapshot including live children; cached per state. */
  getSnapshot(): Snapshot
  /** Pure query: why a step is (not) where the caller expects (`machine/explain`); never throws. */
  explain(step: string): Explanation
  /** State listeners: once per committed batch. */
  subscribe(listener: (state: WizardState) => void): () => void
  /** Event listeners: every event of this wizard and its children (`event.path`). */
  observe(listener: (event: DomainEvent) => void): () => void
  log(): readonly DomainEvent[]
  /** Live nested runtime of a `flow` step. Throws `NOT_A_FLOW_STEP` / `NOT_ACTIVE`. */
  child(step: string): WizardRuntime
  /** Write a snapshot now (no-op without a store). */
  save(): Promise<void>
  dispose(): void
  isDisposed(): boolean
}

// ---------------------------------------------------------------------------
// Internal config shared by root, resume and children
// ---------------------------------------------------------------------------

/**
 * @internal Normalized options; shared by a root and all its children except `deps`, which
 * each child runtime receives for itself (`{ ...cfg, deps }` in the child factory).
 */
export interface RuntimeConfig {
  readonly machine: Machine
  readonly initialState: InitialState
  readonly env: RuntimeEnv
  /** This runtime's deps (`args.deps` in its hooks; the default for its children). */
  readonly deps: unknown
  readonly strict: 'sync' | undefined
  readonly logSize: number | undefined
  readonly abortGraceMs: number | undefined
  readonly onListenerError: ((error: unknown) => void) | undefined
  readonly persistence:
    | {
        readonly store: Store
        readonly key: string | undefined
        readonly autoSave: 'change' | 'off'
        readonly debounceMs: number
        readonly redact: ((snapshot: Snapshot) => unknown) | undefined
        readonly clearOnDone: boolean | undefined
        readonly onError: ((error: unknown) => void) | undefined
      }
    | undefined
  /**
   * Restore a child runtime from its prepared plan (resume path). Injected by
   * `resume.ts` so this module never imports it (no cycle); a runtime built by
   * `createWizardRuntime` never restores children.
   */
  readonly restore: RestoreChild
}

/**
 * @internal What `resume.ts` prepared, recursively: the validated snapshot, the
 * boundary-substituted state (`epoch + 1`) and the plans of the children found in
 * `snapshot.children`. Built once, before anything is instantiated (atomic).
 */
export interface ResumePlan {
  readonly snapshot: Snapshot
  readonly state: WizardState
  readonly children: Readonly<Record<string, ResumePlan>>
}

/** @internal */
export type RestoreChild = (
  def: CompiledFlow,
  plan: ResumePlan,
  cfg: RuntimeConfig,
  path: readonly string[],
  ancestors: readonly object[],
) => WizardRuntime

/** @internal */
export function toConfig(opts: ResumeWizardRuntimeOptions, restore: RestoreChild): RuntimeConfig {
  const scheduler = opts.scheduler ?? createRealScheduler()
  const clock = opts.clock ?? (isClock(scheduler) ? scheduler : createRealClock())
  return {
    machine: opts.machine,
    initialState: opts.initialState,
    env: { clock, scheduler, ids: opts.ids ?? createIdGenerator() },
    deps: opts.deps,
    strict: opts.strict,
    logSize: opts.logSize,
    abortGraceMs: opts.abortGraceMs,
    onListenerError: opts.onListenerError,
    persistence:
      opts.store === undefined
        ? undefined
        : {
            store: opts.store,
            key: opts.key,
            autoSave: opts.autoSave ?? 'change',
            debounceMs: opts.debounceMs ?? 0,
            redact: opts.redact,
            clearOnDone: opts.clearOnDone,
            onError: opts.onPersistError,
          },
    restore,
  }
}

function isClock(value: object): value is Clock & object {
  return 'now' in value && typeof value.now === 'function'
}

/** @internal */
export function machineEnv(
  def: CompiledFlow,
  path: readonly string[],
  env: RuntimeEnv,
): MachineEnv {
  return { def, path, now: () => env.clock.now(), id: (prefix) => env.ids.id(prefix) }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a fresh wizard instance from an already-parsed context. */
export function createWizardRuntime(def: CompiledFlow, opts: WizardRuntimeOptions): WizardRuntime {
  const cfg = toConfig(opts, () => {
    throw new Error('children are only restored on the resume path')
  })
  const instanceId = opts.instanceId ?? cfg.env.ids.id('wiz')
  const state = cfg.initialState(machineEnv(def, [], cfg.env), {
    instanceId,
    context: opts.context,
    now: cfg.env.clock.now(),
    epoch: 0,
  })
  return buildRuntime(def, cfg, { state, path: [], ancestors: [], persist: true })
}

// ---------------------------------------------------------------------------
// Runtime construction
// ---------------------------------------------------------------------------

/** @internal */
export interface BuildInit {
  readonly state: WizardState
  readonly path: readonly string[]
  readonly ancestors: readonly object[]
  /** Only the root persists; children ride along in `Snapshot.children`. */
  readonly persist: boolean
}

/** @internal `WizardRuntime` plus the resume trigger used by `resume.ts`. */
export interface InternalRuntime extends WizardRuntime {
  /** Send the `resume` message and re-attach the prepared children (resume path only). */
  resumeFrom(plan: ResumePlan): void
}

interface Processed {
  readonly batch: readonly DomainEvent[]
  readonly seq: number
  readonly disposed: boolean
}

type TxOutcome =
  | {
      readonly kind: 'committed'
      readonly from: string | null
      readonly to: string
      readonly seq: number
    }
  | {
      readonly kind: 'rejected'
      readonly reason: TransitionRejectReason
      readonly step?: string
      readonly issues?: readonly Issue[]
    }
  | { readonly kind: 'failed'; readonly step: string; readonly error: SerializedError }
  | { readonly kind: 'disposed' }

interface TxSlot {
  outcome: TxOutcome | undefined
  readonly waiters: Array<(outcome: TxOutcome) => void>
}

type MaybePromise<T> = T | Promise<T>

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return getThen(value) !== undefined
}

/** Continue synchronously when possible; otherwise chain. */
function after<T, R>(
  value: MaybePromise<T>,
  fn: (resolved: T) => MaybePromise<R>,
): MaybePromise<R> {
  return isPromiseLike(value) ? value.then(fn) : fn(value)
}

/** A promise that is already fulfilled for sync values (no extra tick). */
function asPromise<T>(value: MaybePromise<T>): Promise<T> {
  return isPromiseLike(value) ? value : Promise.resolve(value)
}

/** @internal Build a runtime around an interpreter (root, resumed root, or child). */
export function buildRuntime(
  def: CompiledFlow,
  cfg: RuntimeConfig,
  init: BuildInit,
): InternalRuntime {
  const { env } = cfg
  const instanceId = init.state.instanceId
  const stateListeners = new Set<(state: WizardState) => void>()
  const eventListeners = new Set<(event: DomainEvent) => void>()
  const pendingMessages = new Map<Message, (processed: Processed) => void>()
  const txSlots = new Map<string, TxSlot>()
  /** Façade-side async work (boundaries, validate hooks) still pending: settled on dispose. */
  const pendingOps = new Set<() => void>()
  let disposed = false
  let snapshotCache:
    | { state: WizardState; children: Record<string, Snapshot>; snapshot: Snapshot }
    | undefined

  const onListenerError =
    cfg.onListenerError ??
    ((error: unknown) => {
      queueMicrotask(() => {
        throw error
      })
    })

  const notify = <T>(listeners: Set<(value: T) => void>, value: T): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(value)
      } catch (error) {
        onListenerError(error)
      }
    }
  }

  const disposedError = (): WizardError =>
    new WizardError('DISPOSED', `wizard '${instanceId}' is disposed`)

  // ---- transaction tracking -------------------------------------------------

  const settleTx = (txId: string, outcome: TxOutcome): void => {
    const slot = txSlots.get(txId)
    if (slot === undefined || slot.outcome !== undefined) return
    slot.outcome = outcome
    if (slot.waiters.length > 0) {
      txSlots.delete(txId)
      for (const waiter of slot.waiters.splice(0)) waiter(outcome)
    }
  }

  /** Outcome now if known, else a promise (settled by the terminal event, `settle` effect or dispose). */
  const awaitTx = (txId: string): MaybePromise<TxOutcome> => {
    if (disposed) return { kind: 'disposed' }
    const slot = txSlots.get(txId)
    if (slot?.outcome !== undefined) {
      txSlots.delete(txId)
      return slot.outcome
    }
    return new Promise((resolve) => {
      if (slot === undefined) txSlots.set(txId, { outcome: undefined, waiters: [resolve] })
      else slot.waiters.push(resolve)
    })
  }

  const trackTx = (event: DomainEvent): void => {
    if (event.type === 'transition.committed') {
      settleTx(event.txId, { kind: 'committed', from: event.from, to: event.to, seq: event.seq })
    } else if (event.type === 'transition.rejected') {
      settleTx(event.txId, {
        kind: 'rejected',
        reason: event.reason,
        ...(event.step !== undefined ? { step: event.step } : {}),
        ...(event.issues !== undefined ? { issues: event.issues } : {}),
      })
    } else if (event.type === 'transition.failed') {
      settleTx(event.txId, { kind: 'failed', step: event.step, error: event.error })
    }
  }

  // ---- child factory (recursive) --------------------------------------------

  // Each child runs with ITS deps (`s.flow(child, { deps })` mapped + parsed by the bridge, or the
  // parent's deps passed through); everything else in the config is shared.
  const childFactory: ChildFactory<WizardRuntime, ResumePlan> = {
    create: (args) => {
      const state = cfg.initialState(machineEnv(args.def, args.path, env), {
        instanceId: env.ids.id('wiz'),
        context: args.context,
        now: env.clock.now(),
        epoch: 0,
      })
      return buildRuntime(
        args.def,
        { ...cfg, deps: args.deps },
        { state, path: args.path, ancestors: args.ancestors, persist: false },
      )
    },
    restore: (args) =>
      cfg.restore(args.def, args.plan, { ...cfg, deps: args.deps }, args.path, args.ancestors),
  }

  // ---- interpreter -----------------------------------------------------------

  let driver: PersistenceDriver | undefined

  const interp: Interpreter<WizardRuntime, ResumePlan> = createInterpreter<
    WizardRuntime,
    ResumePlan
  >({
    def,
    machine: cfg.machine,
    path: init.path,
    env,
    initialState: init.state,
    deps: cfg.deps,
    ...(cfg.strict !== undefined ? { strict: cfg.strict } : {}),
    ...(cfg.logSize !== undefined ? { logSize: cfg.logSize } : {}),
    ...(cfg.abortGraceMs !== undefined ? { abortGraceMs: cfg.abortGraceMs } : {}),
    children: { factory: childFactory, ancestors: init.ancestors },
    onListenerError,
    onEvent: (event) => {
      if (samePath(event.path, init.path)) trackTx(event)
      notify(eventListeners, event)
    },
    onCommit: (state) => {
      snapshotCache = undefined
      notify(stateListeners, state)
    },
    onProcessed: (msg, batch) => {
      const resolve = pendingMessages.get(msg)
      if (resolve === undefined) return
      pendingMessages.delete(msg)
      // Reserve a slot for a transaction this command started but did not finish in its batch,
      // so a terminal event landing later in the same drain is not missed.
      for (const event of batch) {
        if (
          event.type === 'transition.started' &&
          !terminalIn(batch, event.txId) &&
          !txSlots.has(event.txId)
        ) {
          txSlots.set(event.txId, { outcome: undefined, waiters: [] })
        }
      }
      resolve({ batch, seq: interp.getState().seq, disposed: false })
    },
    onEffect: (effect: Effect) => {
      if (effect.kind === 'settle') {
        settleTx(effect.txId, settleOutcome(effect, interp.getState().seq))
      } else if (effect.kind === 'persist') {
        driver?.notify(effect.reason)
      }
    },
  })

  /** A write failed (auto-save or `save()`): record `persist.failed`, then hand the error on. */
  const reportPersistFailure = (key: string, error: unknown): void => {
    const notSerializable =
      error instanceof WizardError && error.code === 'SNAPSHOT_NOT_SERIALIZABLE'
    const location = notSerializable ? locationOf(error.issues) : undefined
    interp.record({
      type: 'persist.failed',
      reason: notSerializable ? 'not-serializable' : 'store',
      key,
      message: describeError(error),
      ...(location === undefined ? {} : { location }),
    })
  }

  if (init.persist && cfg.persistence !== undefined) {
    const p = cfg.persistence
    const key = p.key ?? instanceId
    const onError =
      p.onError ??
      ((error: unknown) => {
        queueMicrotask(() => {
          throw error
        })
      })
    driver = createPersistenceDriver({
      store: p.store,
      key,
      autoSave: p.autoSave,
      debounceMs: p.debounceMs,
      scheduler: env.scheduler,
      getSnapshot: () => getSnapshot(),
      redact: p.redact,
      clearOnDone: p.clearOnDone,
      onError: (error) => {
        reportPersistFailure(key, error)
        onError(error)
      },
      reviveAt: (path, value) => canReviveAt(def, value, path),
    })
  }

  // ---- command plumbing --------------------------------------------------------

  /**
   * Enqueue a command. Returns the processed batch synchronously when the
   * interpreter drained it before returning (the common case), otherwise a
   * promise (re-entrant calls made from inside a drain).
   */
  const enqueue = (command: Command): MaybePromise<Processed> => {
    if (disposed) return { batch: [], seq: interp.getState().seq, disposed: true }
    let sync: Processed | undefined
    let later: ((processed: Processed) => void) | undefined
    pendingMessages.set(command, (processed) => {
      if (later !== undefined) later(processed)
      else sync = processed
    })
    try {
      interp.send(command)
    } catch (error) {
      pendingMessages.delete(command)
      throw error
    }
    if (sync !== undefined) return sync
    return new Promise<Processed>((resolve) => {
      later = resolve
    })
  }

  /** Reject on misuse (disposed / thrown), otherwise run — sync work yields an already-fulfilled promise. */
  const guarded = <T>(fn: () => MaybePromise<T>): Promise<T> => {
    if (disposed) return Promise.reject(disposedError())
    try {
      return asPromise(fn())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /**
   * Façade-side async work (a thenable boundary or validate hook) must not
   * outlive the wizard: `dispose()` settles it with `onDisposed()`; the
   * abandoned thenable keeps its handlers so it never rejects unhandled.
   */
  const untilDisposed = <T>(work: Promise<T>, onDisposed: () => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const settle = (): void => {
        pendingOps.delete(settle)
        try {
          resolve(onDisposed())
        } catch (error) {
          reject(error)
        }
      }
      pendingOps.add(settle)
      work.then(
        (value) => {
          if (pendingOps.delete(settle)) resolve(value)
        },
        (error: unknown) => {
          if (pendingOps.delete(settle)) reject(error)
        },
      )
    })

  const commandResult = (processed: Processed): CommandResult => {
    if (processed.disposed) return { ok: false, code: 'DISPOSED', message: 'wizard disposed' }
    const rejected = findRejected(processed.batch)
    if (rejected !== undefined) return rejected
    return { ok: true, seq: processed.seq }
  }

  const navResult = (processed: Processed): MaybePromise<NavResult> => {
    if (processed.disposed) {
      return { ok: false, reason: 'failed', code: 'DISPOSED', message: 'wizard disposed' }
    }
    const rejected = findRejected(processed.batch)
    if (rejected !== undefined) {
      return {
        ok: false,
        reason: reasonForCode(rejected.code),
        code:
          rejected.code === 'FLOW_COMPENSATING' || rejected.code === 'STALE'
            ? 'INVALID_COMMAND'
            : rejected.code,
        message: rejected.message,
        ...(rejected.step !== undefined ? { step: rejected.step } : {}),
        ...(rejected.issues !== undefined ? { issues: rejected.issues } : {}),
      }
    }
    // The command's OWN transaction: the first non-auto `transition.started` of the batch (a
    // cursor-rule / auto-advance transaction may commit in the same batch, right after it).
    let txId: string | undefined
    for (const event of processed.batch) {
      if (event.type !== 'transition.started') continue
      if (event.cause !== 'auto') {
        txId = event.txId
        break
      }
      txId ??= event.txId
    }
    if (txId === undefined) {
      // A pre-flight rejection (nav-busy, not-active, not-a-view, ...) has no `transition.started`;
      // it carries its own (fresh) txId and settles in the same batch.
      const bare = processed.batch.find((event) => event.type === 'transition.rejected')
      if (bare !== undefined) return toNavResult(toOutcome(bare))
      return {
        ok: false,
        reason: 'not-active',
        code: 'INVALID_COMMAND',
        message: 'no transition was started',
      }
    }
    const inBatch = terminalIn(processed.batch, txId)
    if (inBatch !== undefined) return toNavResult(toOutcome(inBatch))
    return after(awaitTx(txId), toNavResult)
  }

  const runCommand = (command: Command): Promise<CommandResult> =>
    asPromise(after(enqueue(command), commandResult))

  const runNav = (command: Command): Promise<NavResult> =>
    asPromise(after(enqueue(command), navResult))

  const sendInternal = (
    event: string,
    payload: unknown,
    correlationId: string | undefined,
  ): MaybePromise<SendResult> => {
    const boundary = def.events[event]
    if (boundary === undefined) {
      throw new WizardError('UNKNOWN_EVENT', `flow '${def.name}' declares no event '${event}'`)
    }
    const routed = after(boundary.parse(payload), (parsed): MaybePromise<SendResult> => {
      if (disposed) return DROPPED_DISPOSED
      if (!parsed.ok) {
        const issues = parsed.issues
        return after(
          enqueue({ type: 'sendRejected', event, issues }),
          (): SendResult => ({
            ok: false,
            reason: 'rejected',
            code: 'BOUNDARY_REJECTED',
            message: 'payload rejected by the event boundary',
            issues,
          }),
        )
      }
      return after(
        enqueue({
          type: 'send',
          event,
          payload: parsed.value,
          ...(correlationId !== undefined ? { correlationId } : {}),
        }),
        (processed) => sendResult(event, processed),
      )
    })
    return isPromiseLike(routed) ? untilDisposed(routed, () => DROPPED_DISPOSED) : routed
  }

  const validateInternal = (step: string): MaybePromise<readonly Issue[]> => {
    const stepDef = def.steps[step]
    if (stepDef === undefined) {
      throw new WizardError('UNKNOWN_STEP', `unknown step '${step}'`, { step })
    }
    const state = interp.getState()
    const draft = state.steps[step]?.input
    const controller = new AbortController()
    const runHook = (value: unknown): MaybePromise<readonly Issue[]> => {
      const validate = stepDef.hooks.validate
      if (validate === undefined) return []
      const args = buildHookArgs({
        def,
        path: init.path,
        instanceId,
        deps: cfg.deps,
        state,
        step,
        signal: controller.signal,
        update: () => {},
        extra: { input: value },
      })
      const toIssues = (issues: unknown): readonly Issue[] =>
        Array.isArray(issues) ? (issues as readonly Issue[]) : []
      const onError = (error: unknown): readonly Issue[] => [{ message: describeError(error) }]
      try {
        const result = validate(args)
        return isPromiseLike(result) ? result.then(toIssues, onError) : toIssues(result)
      } catch (error) {
        return onError(error)
      }
    }
    const issues =
      stepDef.input === undefined
        ? runHook(draft)
        : after(stepDef.input.parse(draft), (parsed) =>
            parsed.ok ? runHook(parsed.value) : parsed.issues,
          )
    if (!isPromiseLike(issues)) return issues
    return untilDisposed(issues, () => {
      controller.abort(disposedError())
      throw disposedError()
    })
  }

  const dispatchInternal = (input: Command): MaybePromise<CommandResult> => {
    const parsed = decodeCommand(input)
    if (!parsed.ok) {
      return {
        ok: false,
        code: 'INVALID_COMMAND',
        message: 'invalid command shape',
        issues: parsed.issues,
      }
    }
    const command = parsed.value
    switch (command.type) {
      case 'next':
      case 'back':
      case 'go':
        return after(enqueue(command), (processed) =>
          after(navResult(processed), navToCommandResult),
        )
      case 'send': {
        // The wire door runs the event boundary too (plan §1.3): a client cannot bypass it.
        if (def.events[command.event] === undefined) {
          return { ok: false, code: 'UNKNOWN_EVENT', message: `unknown event '${command.event}'` }
        }
        return after(
          sendInternal(command.event, command.payload, command.correlationId),
          sendToCommandResult,
        )
      }
      default:
        // `child` commands are ordinary commands: the parent machine gates them and plans `child.send`.
        return after(enqueue(command), commandResult)
    }
  }

  // ---- snapshot ------------------------------------------------------------------

  const getSnapshot = (): Snapshot => {
    const state = interp.getState()
    const children = interp.childSnapshots()
    if (
      snapshotCache !== undefined &&
      snapshotCache.state === state &&
      sameChildren(snapshotCache.children, children)
    ) {
      return snapshotCache.snapshot
    }
    const snapshot = toSnapshot(state, children, env.clock.now())
    snapshotCache = { state, children, snapshot }
    return snapshot
  }

  // ---- public object -----------------------------------------------------------

  const runtime: InternalRuntime = {
    id: instanceId,
    path: init.path,
    get epoch() {
      return interp.getState().epoch
    },
    start: () => guarded(() => runCommand({ type: 'start' })),
    next: () => guarded(() => runNav({ type: 'next' })),
    back: () => guarded(() => runNav({ type: 'back' })),
    go: (step) => guarded(() => runNav({ type: 'go', step })),
    setInput: (step, patch) => guarded(() => runCommand({ type: 'setInput', step, patch })),
    resetInput: (step) => guarded(() => runCommand({ type: 'resetInput', step })),
    validate: (step) => guarded(() => validateInternal(step)),
    send: (event, payload, options) =>
      guarded(() => sendInternal(event, payload, options?.correlationId)),
    run: (step) => guarded(() => runCommand({ type: 'run', step })),
    retry: (step) => guarded(() => runCommand({ type: 'retry', step })),
    cancel: (reason) =>
      guarded(() =>
        runCommand(reason === undefined ? { type: 'cancel' } : { type: 'cancel', reason }),
      ),
    runReady: () => guarded(() => runCommand({ type: 'runReady' })),
    compensate: (options) =>
      guarded(() =>
        runCommand({
          type: 'compensate',
          ...(options?.from !== undefined ? { from: options.from } : {}),
          ...(options?.reason !== undefined ? { reason: options.reason } : {}),
        }),
      ),
    reset: () => guarded(() => runCommand({ type: 'reset' })),
    dispatch: (command) => guarded(() => dispatchInternal(command)),
    getState: () => interp.getState(),
    getSnapshot,
    explain: (step) => explain(def, interp.getState(), step),
    subscribe(listener) {
      if (disposed) throw disposedError()
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    observe(listener) {
      if (disposed) throw disposedError()
      eventListeners.add(listener)
      return () => {
        eventListeners.delete(listener)
      }
    },
    log: () => interp.log(),
    child(step) {
      if (disposed) throw disposedError()
      const stepDef = def.steps[step]
      if (stepDef === undefined || stepDef.kind !== 'flow') {
        throw new WizardError('NOT_A_FLOW_STEP', `'${step}' is not a flow step`, { step })
      }
      const child = interp.child(step)
      if (child === undefined) {
        throw new WizardError('NOT_ACTIVE', `child flow '${step}' has not been created yet`, {
          step,
        })
      }
      return child
    },
    save: () =>
      guarded(() =>
        driver === undefined
          ? undefined
          : driver.save().then(undefined, (error: unknown) => {
              reportPersistFailure(cfg.persistence?.key ?? instanceId, error)
              throw error
            }),
      ),
    dispose() {
      if (disposed) return
      disposed = true
      driver?.dispose()
      interp.dispose()
      for (const resolve of pendingMessages.values()) {
        resolve({ batch: [], seq: interp.getState().seq, disposed: true })
      }
      pendingMessages.clear()
      for (const [txId, slot] of Array.from(txSlots.entries())) {
        txSlots.delete(txId)
        for (const waiter of slot.waiters.splice(0)) waiter({ kind: 'disposed' })
      }
      for (const settle of Array.from(pendingOps)) settle()
      stateListeners.clear()
      eventListeners.clear()
    },
    isDisposed: () => disposed,
    resumeFrom(plan) {
      // The machine applies the recovery matrix (and re-creates active flow steps whose child
      // summary was stripped by `prepareResume` because no child snapshot was persisted);
      // children that were persisted are re-attached from their prepared plans, single-pass.
      interp.send({ type: 'resume', fromSeq: plan.snapshot.seq })
      for (const [step, childPlan] of Object.entries(plan.children))
        interp.restoreChild(step, childPlan)
    },
  }

  return runtime
}

// ---------------------------------------------------------------------------
// Result mapping
// ---------------------------------------------------------------------------

type ResultCode = WizardErrorCode | 'STALE' | 'FLOW_COMPENSATING'

const RESULT_CODES: ReadonlySet<string> = new Set<ResultCode>([
  'UNKNOWN_STEP',
  'UNKNOWN_EVENT',
  'NOT_A_VIEW',
  'NOT_A_TASK',
  'NOT_A_FLOW_STEP',
  'NOT_ACTIVE',
  'NOT_REACHABLE',
  'NAV_BUSY',
  'NO_TARGET',
  'NO_HISTORY',
  'INVALID_INPUT',
  'BOUNDARY_REJECTED',
  'GUARD_BLOCKED',
  'FLOW_TERMINAL',
  'FLOW_NOT_STARTED',
  'INVALID_COMMAND',
  'SYNC_VIOLATION',
  'SNAPSHOT_INCOMPATIBLE',
  'NESTING_CYCLE',
  'NESTING_TOO_DEEP',
  'DEFINITION_INVALID',
  'DISPOSED',
  'STALE',
  'FLOW_COMPENSATING',
])

function isResultCode(code: string): code is ResultCode {
  return RESULT_CODES.has(code)
}

/** A `WizardErrorCode` carried by a serialized hook error (e.g. `SYNC_VIOLATION`), if recognized. */
function wizardCodeOf(error: SerializedError): WizardErrorCode | undefined {
  const code = error.code
  if (code === undefined || !isResultCode(code) || code === 'STALE' || code === 'FLOW_COMPENSATING')
    return undefined
  return code
}

type RejectedResult = Extract<CommandResult, { ok: false }>

function findRejected(batch: readonly DomainEvent[]): RejectedResult | undefined {
  for (const event of batch) {
    if (event.type !== 'command.rejected') continue
    const step =
      'step' in event.command && typeof event.command.step === 'string'
        ? event.command.step
        : event.command.type === 'child'
          ? event.command.path[0]
          : undefined
    return {
      ok: false,
      code: isResultCode(event.code) ? event.code : 'INVALID_COMMAND',
      message: event.reason,
      ...(step !== undefined ? { step } : {}),
    }
  }
  return undefined
}

function terminalIn(batch: readonly DomainEvent[], txId: string): DomainEvent | undefined {
  let found: DomainEvent | undefined
  for (const event of batch) {
    if (
      (event.type === 'transition.committed' ||
        event.type === 'transition.rejected' ||
        event.type === 'transition.failed') &&
      event.txId === txId
    ) {
      found = event
    }
  }
  return found
}

function toOutcome(event: DomainEvent): TxOutcome {
  switch (event.type) {
    case 'transition.committed':
      return { kind: 'committed', from: event.from, to: event.to, seq: event.seq }
    case 'transition.rejected':
      return {
        kind: 'rejected',
        reason: event.reason,
        ...(event.step !== undefined ? { step: event.step } : {}),
        ...(event.issues !== undefined ? { issues: event.issues } : {}),
      }
    case 'transition.failed':
      return { kind: 'failed', step: event.step, error: event.error }
    default:
      return { kind: 'disposed' }
  }
}

function settleOutcome(effect: Extract<Effect, { kind: 'settle' }>, seq: number): TxOutcome {
  if (effect.outcome === 'ok') {
    const value = effect.value
    const from =
      typeof value === 'object' &&
      value !== null &&
      'from' in value &&
      typeof value.from === 'string'
        ? value.from
        : null
    const to =
      typeof value === 'object' && value !== null && 'to' in value && typeof value.to === 'string'
        ? value.to
        : ''
    return { kind: 'committed', from, to, seq }
  }
  if (effect.outcome === 'rejected') return { kind: 'rejected', reason: 'not-reachable' }
  return {
    kind: 'failed',
    step: '',
    error: {
      name: 'Error',
      message: typeof effect.error === 'string' ? effect.error : 'transition failed',
    },
  }
}

const NAV_CODE: Readonly<Record<TransitionRejectReason, WizardErrorCode>> = {
  'nav-busy': 'NAV_BUSY',
  'not-a-view': 'NOT_A_VIEW',
  'not-active': 'NOT_ACTIVE',
  'not-reachable': 'NOT_REACHABLE',
  validation: 'INVALID_INPUT',
  'guard-canExit': 'GUARD_BLOCKED',
  'guard-canEnter': 'GUARD_BLOCKED',
  'no-target': 'NO_TARGET',
  'no-history': 'NO_HISTORY',
  'flow-terminal': 'FLOW_TERMINAL',
  'flow-not-started': 'FLOW_NOT_STARTED',
  'flow-compensating': 'INVALID_COMMAND',
  resumed: 'INVALID_COMMAND',
  'auto-advance-loop': 'INVALID_COMMAND',
}

const CODE_REASON: Readonly<Partial<Record<ResultCode, TransitionRejectReason>>> = {
  NAV_BUSY: 'nav-busy',
  NOT_A_VIEW: 'not-a-view',
  NOT_ACTIVE: 'not-active',
  NOT_REACHABLE: 'not-reachable',
  INVALID_INPUT: 'validation',
  GUARD_BLOCKED: 'guard-canEnter',
  NO_TARGET: 'no-target',
  NO_HISTORY: 'no-history',
  FLOW_TERMINAL: 'flow-terminal',
  FLOW_NOT_STARTED: 'flow-not-started',
  FLOW_COMPENSATING: 'flow-compensating',
  UNKNOWN_STEP: 'not-a-view',
}

function reasonForCode(code: ResultCode): TransitionRejectReason {
  return CODE_REASON[code] ?? 'not-reachable'
}

function toNavResult(outcome: TxOutcome): NavResult {
  switch (outcome.kind) {
    case 'committed':
      return { ok: true, from: outcome.from, to: outcome.to, seq: outcome.seq }
    case 'rejected':
      return {
        ok: false,
        reason: outcome.reason,
        code: NAV_CODE[outcome.reason],
        message: `transition rejected: ${outcome.reason}`,
        ...(outcome.step !== undefined ? { step: outcome.step } : {}),
        ...(outcome.issues !== undefined ? { issues: outcome.issues } : {}),
      }
    case 'failed':
      return {
        ok: false,
        reason: 'failed',
        // A recognized WizardError code on the hook error (SYNC_VIOLATION, UNKNOWN_STEP, ...) survives.
        code: wizardCodeOf(outcome.error) ?? 'HOOK_FAILED',
        message: outcome.error.message,
        ...(outcome.step.length > 0 ? { step: outcome.step } : {}),
        error: outcome.error,
      }
    case 'disposed':
      return { ok: false, reason: 'failed', code: 'DISPOSED', message: 'wizard disposed' }
  }
}

function navToCommandResult(result: NavResult): CommandResult {
  if (result.ok) return { ok: true, seq: result.seq }
  return {
    ok: false,
    code: result.code === 'HOOK_FAILED' ? 'INVALID_COMMAND' : result.code,
    message: result.message,
    ...(result.step !== undefined ? { step: result.step } : {}),
    ...('issues' in result && result.issues !== undefined ? { issues: result.issues } : {}),
  }
}

const DROPPED_DISPOSED: SendResult = {
  ok: false,
  reason: 'dropped',
  code: 'DISPOSED',
  message: 'wizard disposed',
}

function sendResult(event: string, processed: Processed): SendResult {
  if (processed.disposed) return DROPPED_DISPOSED
  const rejected = findRejected(processed.batch)
  if (rejected !== undefined) {
    return { ok: false, reason: 'dropped', code: rejected.code, message: rejected.message }
  }
  const delivered: string[] = []
  let buffered = false
  let dropped: string | undefined
  for (const ev of processed.batch) {
    if (ev.type === 'event.delivered' && ev.event === event) delivered.push(ev.to)
    else if (ev.type === 'event.buffered' && ev.event === event) buffered = true
    else if (ev.type === 'event.dropped' && ev.event === event) dropped = ev.reason
  }
  if (delivered.length > 0 || buffered) return { ok: true, delivered, buffered, seq: processed.seq }
  return {
    ok: false,
    reason: 'dropped',
    code: 'NOT_ACTIVE',
    message: dropped ?? 'event was not routed',
  }
}

function sendToCommandResult(result: SendResult): CommandResult {
  if (result.ok) return { ok: true, seq: result.seq }
  if (result.reason === 'rejected') {
    return { ok: false, code: result.code, message: result.message, issues: result.issues }
  }
  return { ok: false, code: result.code, message: result.message }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function samePath(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

function sameChildren(a: Record<string, Snapshot>, b: Record<string, Snapshot>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const key of ak) if (a[key] !== b[key]) return false
  return true
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The offending path of a `SNAPSHOT_NOT_SERIALIZABLE` error (`issues[0].path` segments) as `a.b[0].c`. */
function locationOf(issues: readonly Issue[] | undefined): string | undefined {
  const path = issues?.[0]?.path
  if (path === undefined) return undefined
  let out = ''
  for (const segment of path) {
    const key = typeof segment === 'object' ? segment.key : segment
    out += typeof key === 'number' ? `[${key}]` : `${out.length > 0 ? '.' : ''}${String(key)}`
  }
  return out
}
