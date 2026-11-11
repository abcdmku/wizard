/**
 * Batch-atomic FIFO interpreter. Published state and child snapshots advance only after their
 * host barrier commits. Step versions copy records lazily (versions.ts).
 * Hook calls run in plan order after preceding messages, so they see context when they start.
 * Superseded calls never run. A child yields while an ancestor has queued messages.
 * Synchronous results stay in the current drain. Any drain failure aborts the runtime.
 * @internal
 */
import { machine } from '../machine'
import type { Message } from '../machine/commands'
import type { CallEffect, PersistReason } from '../machine/effects'
import type { DomainEvent } from '../machine/events'
import { settles } from '../machine/quiescence'
import type { MachineEnv } from '../machine/types'
import { RunLifecycleError } from '../wizard/results'
import type { Snapshot } from '../wizard/snapshot'
import { runBarrier } from './barrier'
import type { ChildBridge, ChildHandle } from './child'
import { hasChildDisposals, stageChildSnapshots } from './child-snapshots'
import { abortCommittedWork } from './committed-effects'
import { emitCommittedEvents } from './committed-events'
import { createEachChildBridge } from './each-child'
import { causeOf, envelope } from './envelope'
import { createExecutor, type ExecutorOptions } from './executor'
import { buildHookArgs } from './hook-args'
import { createEffectDispatcher } from './interpreter-effects'
import type { Interpreter, InterpreterOptions } from './interpreter-types'
import { isStaleCall } from './stale-call'
import { createTimerRegistry } from './timers'
import { type ExpectedVersion, rejectStaleVersion } from './version-guard'
import { createStepVersions } from './versions'

export type { Interpreter, InterpreterOptions } from './interpreter-types'

const DEFAULT_LOG_SIZE = 200
interface Queued {
  readonly msg: Message
  readonly causedBy: number | undefined
  readonly expectedVersion?: ExpectedVersion | undefined
}
/** A planned hook call waiting for its turn; `seq` = the last event of the batch that planned it. */
interface QueuedCall {
  readonly effect: CallEffect
  readonly causedBy: number | undefined
  readonly seq: number
}
export function createInterpreter<H extends ChildHandle = ChildHandle, P = Snapshot>(
  opts: InterpreterOptions<H, P>,
): Interpreter<H, P> {
  const { def, path, env } = opts
  const logSize = Math.max(0, opts.logSize ?? DEFAULT_LOG_SIZE)
  const versions = createStepVersions()
  /** The machine's live state; `published` is the immutable view of its last committed batch. */
  let state = opts.initialState
  let published = versions.publish(state)
  /**
   * Child snapshots paired with `published` where they can differ from the live ones: staged with
   * each batch a host barrier gates, frozen at stop. `childSnapshots()` answers them while a
   * barrier is pending and after stop; otherwise the live children (nothing is staged then).
   */
  let children: Record<string, Snapshot> = {}
  let committingChildren: Record<string, Snapshot> | undefined
  let gated = false
  let disposed = false
  let draining = false
  const queue: Queued[] = []
  const calls: QueuedCall[] = []
  /** Drains of children that yielded their call turn until this run's queue is processed. */
  const yielded: Array<() => void> = []
  const parent = opts.parent
  /** step → its latest `step.cancelled`: a call planned before it is aborted as soon as it starts. */
  const cancelled = new Map<string, { readonly seq: number; readonly reason: string | undefined }>()
  const ring: DomainEvent[] = []
  const idleWaiters = new Set<(error?: RunLifecycleError) => void>()
  let dirty = false
  let persistReason: PersistReason | undefined
  const menv: MachineEnv = {
    def,
    path,
    now: () => env.clock.now(),
    id: (prefix) => env.ids.id(prefix),
    ledger: versions.ledger,
    ...(opts.eventIds !== undefined ? { eventIds: opts.eventIds } : {}),
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
  const isIdle = (): boolean => !draining && queue.length === 0
  let hydrating = 0
  let restorationPending = false
  const send = (msg: Message, causedBy?: number, expectedVersion?: ExpectedVersion): void => {
    if (disposed) return
    if (msg.type === 'resume' && restorationPending) {
      queue.unshift({ msg, causedBy, expectedVersion })
      restorationPending = false
    } else queue.push({ msg, causedBy, expectedVersion })
    if (!draining && hydrating === 0 && !restorationPending) drain()
  }
  /** A hook's `progress(value)`: observers see it; it never enters the state or the log. */
  const progress = (step: string, value: unknown): void => {
    if (disposed) return
    const event: DomainEvent = {
      type: 'step.progress',
      step,
      value,
      seq: published.seq,
      at: env.clock.now(),
      path,
    }
    safely(() => opts.onEvent?.(event))
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
    progress,
  }
  const executor =
    opts.hooksExecutor === undefined ? createExecutor(executorCtx) : opts.hooksExecutor(executorCtx)
  const timers = createTimerRegistry({ clock: env.clock, scheduler: env.scheduler })
  const bridge: ChildBridge<H, P> | undefined =
    opts.children === undefined
      ? undefined
      : createEachChildBridge<H, P>({
          def,
          path,
          ancestors: opts.children.ancestors ?? [],
          factory: opts.children.factory,
          ...(opts.children.maxDepth !== undefined ? { maxDepth: opts.children.maxDepth } : {}),
          deps: opts.deps,
          // A child step's `deps` mapper sees the same args as any hook (context, parent deps,
          // `update` → `context.patch`, a fresh signal).
          hookArgs: (step, causedBy) => {
            return buildHookArgs({
              def,
              path,
              instanceId: opts.initialState.instanceId,
              deps: opts.deps,
              state,
              step,
              signal: new AbortController().signal,
              update: (patch) => send({ type: 'context.patch', patch, by: step }, causedBy),
              progress: (value) => progress(step, value),
            })
          },
          getState: () => state,
          send,
          forward: (event) => safely(() => opts.onEvent?.(event)),
          turn: {
            busy: () => queue.length > 0 || parent?.busy() === true,
            defer(resume) {
              if (disposed) return
              yielded.push(resume)
              if (!draining) drain()
            },
          },
        })
  const dispatch = createEffectDispatcher<H, P>({
    timers,
    bridge,
    beforeTimer: opts.beforeTimer,
    getState: () => state,
    send,
    settle: (effect) => safely(() => opts.onEffect?.(effect)),
    persist: (reason) => {
      if (
        reason === 'final' ||
        persistReason === undefined ||
        (persistReason === 'change' && reason === 'manual')
      ) {
        persistReason = reason
      }
    },
  })
  const runCall = ({ effect, causedBy, seq }: QueuedCall): void => {
    const cancel = cancelled.get(effect.step)
    if (cancel !== undefined && cancel.seq > seq) {
      executor.abortUnstarted(effect, causedBy, cancel.reason ?? `step '${effect.step}' cancelled`)
    } else if (isStaleCall(state, effect)) {
      executor.abortUnstarted(
        effect,
        causedBy,
        `hook '${effect.hook}' superseded before it started`,
      )
    } else executor.execute(effect, causedBy)
  }
  const stop = (reason: string): void => {
    if (!gated && bridge !== undefined) children = committingChildren ?? bridge.snapshots()
    disposed = true
    queue.length = 0
    calls.length = 0
    yielded.length = 0
    const error = new RunLifecycleError('RUN_DISPOSED')
    for (const settle of idleWaiters) settle(error)
    idleWaiters.clear()
    executor.abortAll(reason)
    timers.clearAll()
    bridge?.disposeAll()
  }
  /** Owners tear down first: a parent fails its child step, a host records the live children. */
  const abortRuntime = (error: unknown): void => {
    if (disposed) return
    safely(() => parent?.stopped(error))
    safely(() => opts.onFatal?.(error))
    if (!disposed) stop('run aborted')
  }
  /** A failed barrier or a throw inside the drain: the runtime is aborted and the error reported. */
  const fail = (error: unknown): void => {
    abortRuntime(error)
    draining = false
    safely(() => {
      throw error
    })
  }
  const drain = (): void => {
    draining = true
    const continueDrain = (): void => {
      try {
        for (;;) {
          const item = queue.shift()
          if (item !== undefined) {
            const pending = processOne(item.msg, item.causedBy, item.expectedVersion)
            if (pending === undefined) continue
            pending.then(continueDrain, fail)
            return
          }
          if ((yielded.length > 0 || calls.length > 0) && parent?.busy() === true) {
            parent.defer(continueDrain)
            return
          }
          const resume = yielded.shift()
          if (resume !== undefined) {
            resume()
            continue
          }
          const call = calls.shift()
          if (call !== undefined) {
            runCall(call)
            continue
          }
          if (!disposed && executor.pending() === 0 && settles(def, state)) {
            const pending = processOne({ type: 'settle' }, undefined)
            if (pending !== undefined) {
              pending.then(continueDrain, fail)
              return
            }
            if (queue.length > 0 || calls.length > 0) continue
          }
          flushPersist()
          if (queue.length > 0) continue
          draining = false
          for (const settle of idleWaiters) settle()
          idleWaiters.clear()
          if (!disposed) safely(() => opts.onIdle?.())
          return
        }
      } catch (error) {
        fail(error)
      }
    }
    continueDrain()
  }
  const flushPersist = (): void => {
    if (!dirty && persistReason === undefined) return
    const reason: PersistReason = persistReason ?? 'change'
    dirty = false
    persistReason = undefined
    if (!disposed) safely(() => opts.onEffect?.({ kind: 'persist', reason }))
  }
  const processOne = (
    msg: Message,
    causedBy: number | undefined,
    expectedVersion?: ExpectedVersion,
  ): Promise<void> | undefined => {
    const decision =
      rejectStaleVersion(machine, menv, state, msg, expectedVersion) ??
      machine.decide(menv, state, msg)
    if (decision.events.length === 0) {
      safely(() => opts.onProcessed?.(msg, [], published))
      return undefined
    }
    const batch = envelope(decision.events, {
      seq: state.seq,
      at: decision.at,
      path,
      msg,
      causedBy,
    })
    const effects = machine.plan(menv, decision.state, batch)
    const staged =
      opts.beforeEffects !== undefined || hasChildDisposals(effects)
        ? stageChildSnapshots(def, bridge?.snapshots() ?? {}, effects)
        : undefined
    state = decision.state
    const view = versions.publish(state)
    dirty = true
    const publish = (): void => {
      published = view
      committingChildren = staged
      if (staged !== undefined) children = staged
      appendLog(batch)
      emitCommittedEvents(batch, view, (event) => safely(() => opts.onEvent?.(event)), progress)
      safely(() => opts.onCommit?.(view, batch))
      safely(() => opts.onProcessed?.(msg, batch, view))
      abortCommittedWork(batch, { executor, timers, bridge, cancelled, calls, yielded })
      const seq = state.seq
      for (const effect of effects) {
        if (effect.kind === 'call') calls.push({ effect, causedBy: causeOf(effect, batch), seq })
        else dispatch(effect, batch)
      }
      if (msg.type === 'resume') bridge?.resumeRestored()
      committingChildren = undefined
    }
    const beforeEffects = opts.beforeEffects
    if (beforeEffects === undefined) {
      publish()
      return undefined
    }
    gated = true
    const commit = (): void => {
      gated = false
      if (disposed) return
      publish()
    }
    return runBarrier(
      () => beforeEffects(view, batch, effects, staged ?? {}, msg),
      commit,
      abortRuntime,
    )
  }
  const appendLog = (batch: readonly DomainEvent[]): void => {
    if (logSize === 0) return
    for (const event of batch) ring.push(event)
    if (ring.length > logSize) ring.splice(0, ring.length - logSize)
  }
  return {
    send,
    getState: () => published,
    isIdle,
    whenIdle() {
      if (disposed) return Promise.reject(new RunLifecycleError('RUN_DISPOSED'))
      if (isIdle()) return Promise.resolve()
      return new Promise<void>((resolve, reject) => {
        idleWaiters.add((error) => (error ? reject(error) : resolve()))
      })
    },
    log: () => ring.slice(),
    record(body) {
      if (disposed) return
      const event: DomainEvent = { seq: published.seq, at: env.clock.now(), ...body, path }
      appendLog([event])
      safely(() => opts.onEvent?.(event))
    },
    dispose() {
      if (disposed) return
      stop('interpreter disposed')
      safely(() => parent?.stopped(undefined))
    },
    isDisposed: () => disposed,
    child: (step) => bridge?.get(step),
    childSnapshots: () =>
      committingChildren ??
      (gated || disposed || bridge === undefined ? children : bridge.snapshots()),
    restoreChild(step, plan) {
      if (disposed || bridge === undefined) return
      bridge.restore(step, plan)
    },
    restoreChildren(plans) {
      if (disposed || bridge === undefined) return
      hydrating++
      restorationPending = true
      try {
        for (const [step, plan] of Object.entries(plans)) bridge.restore(step, plan)
      } finally {
        hydrating--
      }
    },
    inflight: () => executor.inflight(),
    pending: () => executor.pending(),
  }
}
