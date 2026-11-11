/**
 * Run outcomes, derived once for every door (`run.awaitOutcome()`, `wizard.run()`,
 * `wizard.runSync()`): the terminal result, the failure a halted run stopped on, or what a parked
 * run waits on (its own waits plus those of its live children, flattened by `path`). A run is
 * parked when nothing runs on its own: no hook, transition or retry backoff in flight, in it or in
 * any live child. A run parked on sleeps alone is still parked here; the awaiting doors keep going
 * until the sleeps fire (`isPureSleep`).
 *
 * @internal
 */

import { WizardError } from '../../errors'
import { parseEachChildAddress } from '../../interpreter/each-child'
import { eachItem } from '../../machine/each-state'
import {
  haltFailure,
  type RuntimeHalt,
  type RuntimeResult,
  type RuntimeStepFailure,
} from '../../machine/run-result'
import { phase } from '../../machine/selectors'
import type { StepError, WizardState } from '../../machine/state'
import { type WaitingFor, waitingFor } from '../../machine/waiting-for'
import { RunLifecycleError } from '../results'
import type { Snapshot } from '../snapshot'
import type { RuntimeContext } from './context'
import type { WizardRuntime } from './types'

interface RuntimeHalted extends RuntimeHalt {
  readonly snapshot: Snapshot
}

interface RuntimeWaiting {
  readonly status: 'waiting'
  readonly waitingFor: readonly WaitingFor[]
  readonly snapshot: Snapshot
  readonly seq: number
  readonly epoch: number
}

export type RuntimeOutcome = RuntimeResult | RuntimeHalted | RuntimeWaiting

/** What the run and its live children wait on from the outside right now. */
export function liveWaitingFor(ctx: RuntimeContext): readonly WaitingFor[] {
  const state = ctx.interp.getState()
  const out = [...waitingFor(ctx.def, state)]
  for (const { path, child } of liveChildren(ctx, state))
    out.push(...nested(path, child.waitingFor()))
  return out
}

/** The outcome now, or `undefined` while the run or a live child still works on its own. */
export function outcomeOf(ctx: RuntimeContext): RuntimeOutcome | undefined {
  const result = ctx.terminal.current()
  if (result !== undefined) return result
  const state = ctx.interp.getState()
  if (state.status === 'halted') return halted(ctx, state)
  if (state.status !== 'waiting' && state.status !== 'idle') return undefined
  if (state.nav.phase !== 'idle') return undefined
  const waits = [...waitingFor(ctx.def, state)]
  for (const id of state.active) {
    const step = ctx.def.steps[id]
    if (step?.kind === 'flow' && step.each === undefined && ctx.interp.child(id) !== undefined)
      continue
    if (step?.kind === 'flow' && step.each !== undefined) {
      const each = state.steps[id]?.each
      if (each === undefined) return undefined
      if (each.running === 0 && each.done < each.items.length) return undefined
      continue
    }
    if (phase(ctx.def, state, id) !== 'waiting') return undefined
  }
  for (const { path, child } of liveChildren(ctx, state)) {
    const outcome = child.outcome()
    if (outcome?.status !== 'waiting') return undefined
    waits.push(...nested(path, outcome.waitingFor))
  }
  const { seq, epoch } = state
  return { status: 'waiting', waitingFor: waits, snapshot: ctx.getSnapshot(), seq, epoch }
}

/** Parked on sleeps only: their timers will move the run on without outside input. */
function isPureSleep(outcome: RuntimeOutcome): boolean {
  return (
    outcome.status === 'waiting' &&
    outcome.waitingFor.length > 0 &&
    outcome.waitingFor.every((wait) => wait.kind === 'sleep')
  )
}

/**
 * Resolve with the next outcome that needs the outside world: terminal, halted, or waiting on a
 * view or an event. A waiting outcome must survive the current drain (`whenIdle`) unchanged.
 * Never disposes the run; disposing it rejects with `RunLifecycleError('RUN_DISPOSED')`.
 */
export function awaitOutcome(ctx: RuntimeContext, runtime: WizardRuntime): Promise<RuntimeOutcome> {
  if (ctx.disposed) return Promise.reject(new RunLifecycleError('RUN_DISPOSED'))
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => {}
    /** Resolve with `outcome`, or reject `RUN_DISPOSED` without one. */
    const settle = (outcome?: RuntimeOutcome): void => {
      settled = true
      unsubscribe()
      ctx.pendingOps.delete(onDisposed)
      if (outcome === undefined) reject(new RunLifecycleError('RUN_DISPOSED'))
      else resolve(outcome)
    }
    const onDisposed = (): void => settle()
    const check = (): void => {
      const outcome = settled ? undefined : runtime.outcome()
      if (outcome === undefined || isPureSleep(outcome)) return
      if (outcome.status !== 'waiting') {
        settle(outcome)
        return
      }
      // A disposal during the drain rejects through `onDisposed`.
      runtime.whenIdle().then(
        () => {
          if (!settled && runtime.getState().seq === outcome.seq) settle(outcome)
        },
        () => {},
      )
    }
    ctx.pendingOps.add(onDisposed)
    unsubscribe = runtime.subscribe(check)
    check()
  })
}

/**
 * The outcome of a run that must have finished synchronously; throws `SYNC_VIOLATION` naming the
 * step when a hook returned a promise or a timer (retry backoff, sleep) is required.
 */
export function outcomeSync(runtime: WizardRuntime): RuntimeOutcome {
  const state = runtime.getState()
  const async = Object.values(state.steps).find((rec) => rec.error?.kind === 'sync-violation')
  if (async !== undefined) {
    throw new WizardError(
      'SYNC_VIOLATION',
      `runSync: step '${async.id}' returned a promise; use run() or create() for asynchronous steps`,
      { step: async.id },
    )
  }
  const outcome = runtime.outcome()
  if (outcome !== undefined && !isPureSleep(outcome)) return outcome
  const step =
    Object.values(state.timers).find((timer) => timer.step !== undefined)?.step ?? state.active[0]
  throw new WizardError(
    'SYNC_VIOLATION',
    `runSync: ${step === undefined ? 'the run' : `step '${step}'`} cannot finish synchronously (it needs a timer or a promise); use run() or create()`,
    step === undefined ? {} : { step },
  )
}

function nested(path: readonly string[], waits: readonly WaitingFor[]): readonly WaitingFor[] {
  return waits.map((wait) => ({ ...wait, path: [...path, ...wait.path] }))
}

function halted(ctx: RuntimeContext, state: WizardState): RuntimeHalted {
  const failure = haltFailure(state) ?? childHalt(ctx, state)
  const { seq, epoch } = state
  return { status: 'halted', failure, snapshot: ctx.getSnapshot(), seq, epoch }
}

/**
 * A run halted by a halted child (the halt invariant: a failed step or a halted child): the flow
 * step carries the child's failure, kind `child`, and the child's own halted outcome.
 */
function childHalt(ctx: RuntimeContext, state: WizardState): RuntimeStepFailure {
  let step = state.active.find((id) => state.steps[id]?.child?.status === 'halted') ?? ''
  for (const child of liveChildren(ctx, state)) {
    const outcome = child.child.outcome()
    if (outcome?.status !== 'halted') continue
    step = child.path[0] ?? step
    const error: StepError = { ...outcome.failure.error, kind: 'child' }
    return { kind: 'step', step, error, child: outcome }
  }
  const message = `the child flow of step '${step}' halted; recover it through run.child('${step}')`
  return {
    kind: 'step',
    step,
    error: { name: 'ChildHalted', message, kind: 'child', at: state.updatedAt },
  }
}

function liveChildren(
  ctx: RuntimeContext,
  state: WizardState,
): readonly { path: readonly string[]; child: WizardRuntime }[] {
  const out: { path: readonly string[]; child: WizardRuntime }[] = []
  for (const id of state.active) {
    if (ctx.def.steps[id]?.kind !== 'flow') continue
    const child = ctx.interp.child(id)
    if (child !== undefined) out.push({ path: [id], child })
  }
  const active = new Set(state.active)
  for (const address of Object.keys(ctx.interp.childSnapshots())) {
    if (Object.hasOwn(ctx.def.steps, address)) continue
    const item = parseEachChildAddress(address)
    if (item === undefined || !active.has(item.step)) continue
    const each = state.steps[item.step]?.each
    if (each === undefined || eachItem(each, item.index).status !== 'running') continue
    const child = ctx.interp.child(address)
    if (child !== undefined) out.push({ path: [item.step, String(item.index)], child })
  }
  return out
}
