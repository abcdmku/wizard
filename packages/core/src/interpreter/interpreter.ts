/**
 * The interpreter: one FIFO queue per wizard instance, batch-atomic
 * processing (plan §8.1).
 *
 * ```
 * loop: msg = queue.shift()
 *   events    = machine.decide(env, state, msg)          // pure; [] = no-op
 *   envelopes = seq/at/path/causedBy assigned here
 *   next      = events.reduce(machine.apply, state)      // fold the whole batch
 *   effects   = machine.plan(env, next, events)          // sees POST-batch state
 *   commit    = swap state, append to the log ring, onEvent per event, onCommit once
 *   execute effects (call / timer / child here; settle + persist via onEffect)
 * ```
 *
 * `send()` while a drain is running only enqueues; the outer drain processes
 * the message before the public call returns. Sync hook results are enqueued
 * as `res.ok` and processed in the same drain — that is the sync-commit
 * guarantee. `persist` effects are coalesced to one `onEffect` per drain.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { Message } from '../machine/commands'
import type { Effect } from '../machine/effects'
import type { DomainEvent, DomainEventBody } from '../machine/events'
import type { WizardState } from '../machine/state'
import type { Machine, MachineEnv } from '../machine/types'
import type { Snapshot } from '../wizard/snapshot'
import { type ChildBridge, type ChildFactory, type ChildHandle, createChildBridge } from './child'
import type { RuntimeEnv } from './env'
import { causeOf, envelope } from './envelope'
import { createExecutor, type Executor, type ExecutorOptions } from './executor'
import { buildHookArgs } from './hook-args'
import { createTimerRegistry } from './timers'

export interface InterpreterOptions<H extends ChildHandle = ChildHandle, P = Snapshot> {
  readonly def: CompiledFlow
  readonly machine: Machine
  readonly path: readonly string[]
  readonly env: RuntimeEnv
  readonly initialState: WizardState
  /** Injected dependencies handed to every hook (`args.deps`). */
  readonly deps?: unknown
  readonly strict?: 'sync'
  /** Bounded event ring for `log()`. Default 200. */
  readonly logSize?: number
  /** See `ExecutorOptions.abortGraceMs`. */
  readonly abortGraceMs?: number
  /** Replace the hook executor (tests): receives the same context the default one gets. */
  readonly hooksExecutor?: (ctx: ExecutorOptions) => Executor
  /** Nested-flow support. Without a factory, `child.create` fails the flow step. */
  readonly children?: {
    readonly factory: ChildFactory<H, P>
    readonly ancestors?: readonly object[]
    readonly maxDepth?: number
  }
  /** Every committed event, own and forwarded from children (`event.path` tells them apart). */
  readonly onEvent?: (event: DomainEvent) => void
  /** Once per non-empty batch, after the state swap. */
  readonly onCommit?: (state: WizardState, batch: readonly DomainEvent[]) => void
  /** Once per processed message, after commit (batch may be empty). */
  readonly onProcessed?: (msg: Message, batch: readonly DomainEvent[], state: WizardState) => void
  /** Effects the interpreter does not execute itself: `settle` (immediately) and `persist` (coalesced per drain). */
  readonly onEffect?: (effect: Effect) => void
  /** Listener exceptions are isolated; default rethrows asynchronously. */
  readonly onListenerError?: (error: unknown) => void
}

export interface Interpreter<H extends ChildHandle = ChildHandle, P = Snapshot> {
  /** Enqueue; drains synchronously unless a drain is already running. */
  send(msg: Message, causedBy?: number): void
  getState(): WizardState
  /** Bounded ring of this instance's own events (children have their own logs). */
  log(): readonly DomainEvent[]
  /**
   * Record an out-of-band fact the machine did not decide (`persist.failed`): appended to the
   * log and forwarded to `onEvent` with an envelope at the CURRENT seq — no state change, no
   * seq increment, no effects.
   */
  record(body: DomainEventBody): void
  /** Clear timers, abort in-flight hooks (silently), dispose children. Idempotent. */
  dispose(): void
  isDisposed(): boolean
  /** Live child runtime for a `flow` step, if created. */
  child(step: string): H | undefined
  /** Snapshots of every live child (for `Snapshot.children`). */
  childSnapshots(): Record<string, Snapshot>
  /** Re-attach a child from what was prepared for it (resume; the façade passes a `ResumePlan`). */
  restoreChild(step: string, plan: P): void
  /** Number of unsettled hook calls (tests / diagnostics). */
  inflight(): number
}

const DEFAULT_LOG_SIZE = 200

interface Queued {
  readonly msg: Message
  readonly causedBy: number | undefined
}

type PersistReason = 'change' | 'final' | 'manual'
const PERSIST_RANK: Readonly<Record<PersistReason, number>> = { change: 0, manual: 1, final: 2 }

export function createInterpreter<H extends ChildHandle = ChildHandle, P = Snapshot>(
  opts: InterpreterOptions<H, P>,
): Interpreter<H, P> {
  const { def, machine, path, env } = opts
  const logSize = Math.max(0, opts.logSize ?? DEFAULT_LOG_SIZE)

  let state = opts.initialState
  let disposed = false
  let draining = false
  const queue: Queued[] = []
  const ring: DomainEvent[] = []

  // Persist coalescing (per drain).
  let dirty = false
  let persistReason: PersistReason | undefined

  const menv: MachineEnv = {
    def,
    path,
    now: () => env.clock.now(),
    id: (prefix) => env.ids.id(prefix),
  }

  const onListenerError =
    opts.onListenerError ??
    ((error: unknown) => {
      queueMicrotask(() => {
        throw error
      })
    })

  const safely = (fn: () => void): void => {
    try {
      fn()
    } catch (error) {
      onListenerError(error)
    }
  }

  const send = (msg: Message, causedBy?: number): void => {
    if (disposed) return
    queue.push({ msg, causedBy })
    if (!draining) drain()
  }

  const executorCtx: ExecutorOptions = {
    def,
    path,
    instanceId: opts.initialState.instanceId,
    clock: env.clock,
    scheduler: env.scheduler,
    deps: opts.deps,
    ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
    ...(opts.abortGraceMs !== undefined ? { abortGraceMs: opts.abortGraceMs } : {}),
    getState: () => state,
    send,
  }
  const executor =
    opts.hooksExecutor === undefined ? createExecutor(executorCtx) : opts.hooksExecutor(executorCtx)
  const timers = createTimerRegistry({ clock: env.clock, scheduler: env.scheduler })

  const bridge: ChildBridge<H, P> | undefined =
    opts.children === undefined
      ? undefined
      : createChildBridge<H, P>({
          def,
          path,
          ancestors: opts.children.ancestors ?? [],
          factory: opts.children.factory,
          ...(opts.children.maxDepth !== undefined ? { maxDepth: opts.children.maxDepth } : {}),
          deps: opts.deps,
          // A flow step's `deps` mapper sees the same args as any hook (context, parent deps,
          // `update` → `context.patch`, a fresh signal).
          hookArgs: (step, causedBy) =>
            buildHookArgs({
              def,
              path,
              instanceId: opts.initialState.instanceId,
              deps: opts.deps,
              state,
              step,
              signal: new AbortController().signal,
              update: (patch) => send({ type: 'context.patch', patch, by: step }, causedBy),
            }),
          getState: () => state,
          send,
          forward: (event) => safely(() => opts.onEvent?.(event)),
        })

  // -------------------------------------------------------------------------
  // Drain loop
  // -------------------------------------------------------------------------

  const drain = (): void => {
    draining = true
    try {
      for (;;) {
        const item = queue.shift()
        if (item === undefined) break
        processOne(item.msg, item.causedBy)
      }
    } finally {
      draining = false
      flushPersist()
    }
  }

  const flushPersist = (): void => {
    if (!dirty && persistReason === undefined) return
    const reason: PersistReason = persistReason ?? 'change'
    dirty = false
    persistReason = undefined
    if (!disposed) safely(() => opts.onEffect?.({ kind: 'persist', reason }))
  }

  const processOne = (msg: Message, causedBy: number | undefined): void => {
    const bodies = machine.decide(menv, state, msg)
    if (bodies.length === 0) {
      safely(() => opts.onProcessed?.(msg, [], state))
      return
    }
    const batch = envelope(bodies, { seq: state.seq, at: env.clock.now(), path, msg, causedBy })
    let next = state
    for (const event of batch) next = machine.apply(menv, next, event)
    const effects = machine.plan(menv, next, batch)

    // Commit: swap, log, notify (event listeners per event, state listeners once).
    state = next
    dirty = true
    appendLog(batch)
    for (const event of batch) safely(() => opts.onEvent?.(event))
    safely(() => opts.onCommit?.(state, batch))
    safely(() => opts.onProcessed?.(msg, batch, state))

    // Interpreter-level reactions to committed facts.
    for (const event of batch) {
      if (event.type === 'step.cancelled') executor.abort(event.step, event.reason)
      else if (event.type === 'flow.reset') {
        executor.abortAll('flow reset')
        timers.clearAll()
        bridge?.disposeAll()
      }
    }

    for (const effect of effects) execute(effect, batch)
  }

  const appendLog = (batch: readonly DomainEvent[]): void => {
    if (logSize === 0) return
    for (const event of batch) ring.push(event)
    if (ring.length > logSize) ring.splice(0, ring.length - logSize)
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  const execute = (effect: Effect, batch: readonly DomainEvent[]): void => {
    if (disposed) return
    const cause = causeOf(effect, batch)
    switch (effect.kind) {
      case 'call':
        executor.execute(effect, cause)
        return
      case 'timer.set': {
        const fire = effect.fire
        timers.set(effect.timerId, effect.at, () => send(fire, cause))
        return
      }
      case 'timer.clear':
        timers.clear(effect.timerId)
        return
      case 'child.create':
        if (bridge === undefined) {
          send(
            {
              type: 'res.child',
              step: effect.step,
              token: { step: effect.step, runId: state.steps[effect.step]?.runId ?? 0 },
              summary: {
                status: 'failed',
                current: null,
                progress: 0,
                seq: (state.steps[effect.step]?.child?.seq ?? 0) + 1,
              },
              failed: {
                error: {
                  name: 'WizardError',
                  code: 'CHILD_UNSUPPORTED',
                  message: 'nested flows are not enabled on this interpreter',
                },
              },
            },
            cause,
          )
        } else bridge.create(effect.step, effect.context, cause)
        return
      case 'child.send':
        bridge?.send(effect.step, effect.command)
        return
      case 'child.dispose':
        bridge?.dispose(effect.step)
        return
      case 'persist':
        if (
          persistReason === undefined ||
          PERSIST_RANK[effect.reason] > PERSIST_RANK[persistReason]
        ) {
          persistReason = effect.reason
        }
        return
      case 'settle':
        safely(() => opts.onEffect?.(effect))
        return
    }
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  return {
    send,
    getState: () => state,
    log: () => ring.slice(),
    record(body) {
      if (disposed) return
      const event: DomainEvent = { seq: state.seq, at: env.clock.now(), ...body, path }
      appendLog([event])
      safely(() => opts.onEvent?.(event))
    },
    dispose() {
      if (disposed) return
      disposed = true
      queue.length = 0
      executor.abortAll('interpreter disposed')
      timers.clearAll()
      bridge?.disposeAll()
    },
    isDisposed: () => disposed,
    child: (step) => bridge?.get(step),
    childSnapshots: () => bridge?.snapshots() ?? {},
    restoreChild(step, plan) {
      if (bridge === undefined) return
      bridge.restore(step, plan)
    },
    inflight: () => executor.inflight(),
  }
}
