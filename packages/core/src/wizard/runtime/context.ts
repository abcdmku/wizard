/**
 * The mutable core one runtime instance is built around: the interpreter, listeners, the
 * transaction tracker, the pending-command / pending-operation registries, the snapshot cache and
 * the `persist.failed` recorder. Everything else in `runtime/` is a function of this context.
 *
 * @internal
 */

import type { CompiledFlow } from '../../authoring/compiled'
import { describeError, WizardError } from '../../errors'
import type { ChildFactory } from '../../interpreter/child'
import { createInterpreter, type Interpreter } from '../../interpreter/interpreter'
import type { Message } from '../../machine/commands'
import type { DomainEvent } from '../../machine/events'
import type { Issue, WizardState } from '../../machine/state'
import { samePath } from '../../machine/util'
import type { PersistenceDriver } from '../../persistence/driver'
import { type Snapshot, toSnapshot } from '../snapshot'
import type { Processed } from './results'
import { createTxTracker, type TxTracker } from './transactions'
import type { BuildInit, ResumePlan, RuntimeConfig, WizardRuntime } from './types'

export interface RuntimeContext {
  readonly def: CompiledFlow
  readonly cfg: RuntimeConfig
  readonly init: BuildInit
  readonly instanceId: string
  readonly interp: Interpreter<WizardRuntime, ResumePlan>
  readonly tx: TxTracker
  readonly stateListeners: Set<(state: WizardState) => void>
  readonly eventListeners: Set<(event: DomainEvent) => void>
  /** Resolvers of the commands enqueued and not yet processed. */
  readonly pendingMessages: Map<Message, (processed: Processed) => void>
  /** Façade-side async work (boundaries, validate hooks) still pending: settled on dispose. */
  readonly pendingOps: Set<() => void>
  /** Disposers of `attach()`ed event sources (v0.2): run on `dispose()`. */
  readonly attached: Set<() => void>
  /** The persistence driver of a persisting root (set by `attachPersistence`). */
  driver: PersistenceDriver | undefined
  disposed: boolean
  disposedError(): WizardError
  /** Listener exceptions are isolated; the default rethrows asynchronously. */
  readonly onListenerError: (error: unknown) => void
  /** Isolated listener call: an exception goes to `onListenerError`, never to the caller. */
  notify<T>(listeners: Set<(value: T) => void>, value: T): void
  /** Versioned, JSON-safe snapshot including live children; cached per state + children. */
  getSnapshot(): Snapshot
  /** A write failed (auto-save or `save()`): record `persist.failed` (the caller hands the error on). */
  reportPersistFailure(key: string, error: unknown): void
}

export function createContext(
  def: CompiledFlow,
  cfg: RuntimeConfig,
  init: BuildInit,
  childFactory: (ctx: () => RuntimeContext) => ChildFactory<WizardRuntime, ResumePlan>,
): RuntimeContext {
  const { env } = cfg
  const instanceId = init.state.instanceId
  const onListenerError =
    cfg.onListenerError ??
    ((error: unknown) => {
      queueMicrotask(() => {
        throw error
      })
    })
  let snapshotCache:
    | { state: WizardState; children: Record<string, Snapshot>; snapshot: Snapshot }
    | undefined

  const stateListeners = new Set<(state: WizardState) => void>()
  const eventListeners = new Set<(event: DomainEvent) => void>()
  const pendingMessages = new Map<Message, (processed: Processed) => void>()
  const notify = <T>(listeners: Set<(value: T) => void>, value: T): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(value)
      } catch (error) {
        onListenerError(error)
      }
    }
  }
  // The interpreter's callbacks read `ctx` lazily (they run after construction) — only for the
  // fields that are not known yet here (`tx`, `driver`).
  let ctx: RuntimeContext
  const tx = createTxTracker(() => ctx.disposed)
  const interp = createInterpreter<WizardRuntime, ResumePlan>({
    def,
    machine: cfg.machine,
    path: init.path,
    env,
    initialState: init.state,
    deps: cfg.deps,
    ...(cfg.strict !== undefined ? { strict: cfg.strict } : {}),
    ...(cfg.logSize !== undefined ? { logSize: cfg.logSize } : {}),
    ...(cfg.abortGraceMs !== undefined ? { abortGraceMs: cfg.abortGraceMs } : {}),
    children: { factory: childFactory(() => ctx), ancestors: init.ancestors },
    onListenerError,
    onEvent: (event) => {
      if (samePath(event.path, init.path)) tx.track(event)
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
      tx.reserve(batch)
      resolve({ batch, seq: interp.getState().seq, disposed: false })
    },
    onEffect: (effect) => {
      if (effect.kind === 'settle') tx.settleEffect(effect, interp.getState().seq)
      else if (effect.kind === 'persist') ctx.driver?.notify(effect.reason)
    },
  })
  ctx = {
    def,
    cfg,
    init,
    instanceId,
    interp,
    tx,
    stateListeners,
    eventListeners,
    pendingMessages,
    pendingOps: new Set(),
    attached: new Set(),
    driver: undefined,
    disposed: false,
    onListenerError,
    disposedError: () => new WizardError('DISPOSED', `wizard '${instanceId}' is disposed`),
    notify,
    getSnapshot() {
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
    },
    reportPersistFailure(key, error) {
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
    },
  }
  return ctx
}

function sameChildren(a: Record<string, Snapshot>, b: Record<string, Snapshot>): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const key of ak) if (a[key] !== b[key]) return false
  return true
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
