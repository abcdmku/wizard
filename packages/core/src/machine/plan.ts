/**
 * `plan` — events → effect descriptions. Receives the POST-batch state and the
 * whole batch (plan §8.1), so every rule first checks that the state is still
 * "parked" where the event says (a transaction still in that phase, a step
 * still active with the same runId/attempt, a timer still registered): a batch
 * that moved past a phase synchronously produces no effect for it.
 *
 * One `persist` effect is appended per batch that changed state.
 *
 * @internal
 */

import type { HookName, ResultToken } from './commands'
import type { CallEffect, Effect } from './effects'
import type { DomainEvent } from './events'
import { DEFAULT_COMPENSATION_GRACE_MS } from './saga'
import type { StepRecord, WizardState } from './state'
import type { MachineEnv } from './types'

interface CallOpts {
  readonly extra?: Readonly<Record<string, unknown>>
  readonly attempt?: number
  readonly txId?: string
  readonly timeoutMs?: number
  /** Token runId override (compensation targets a stack entry, not the record's current run). */
  readonly runId?: number
}

function call(env: MachineEnv, rec: StepRecord, hook: HookName, opts: CallOpts = {}): CallEffect {
  const token: ResultToken = {
    step: rec.id,
    runId: opts.runId ?? rec.runId,
    ...(opts.attempt !== undefined ? { attempt: opts.attempt } : {}),
    ...(opts.txId !== undefined ? { txId: opts.txId } : {}),
  }
  return {
    kind: 'call',
    effectId: env.id('fx'),
    step: rec.id,
    hook,
    token,
    ...(opts.extra !== undefined ? { extra: opts.extra } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  }
}

const FINAL_EVENTS: ReadonlySet<string> = new Set([
  'flow.done',
  'flow.cancelled',
  'flow.compensated',
])
export function plan(
  env: MachineEnv,
  state: WizardState,
  events: readonly DomainEvent[],
): readonly Effect[] {
  const out: Effect[] = []
  // Resume effects (re-issued calls, then re-armed timers) go AFTER everything else in the batch
  // so inbox deliveries planned from `event.delivered` run before an overdue timer fires.
  const resume: Effect[] = []
  let final = false
  let resumed = false
  for (const ev of events) {
    if (ev.type === 'flow.resumed') resumed = true
    else planEvent(env, state, ev, out)
    if (FINAL_EVENTS.has(ev.type)) final = true
  }
  if (resumed) {
    // Steps whose entry/compensation started in this very batch already got their calls above.
    const fresh = new Set<string>()
    for (const ev of events) {
      if (
        ev.type === 'step.entered' ||
        ev.type === 'step.enterCompleted' ||
        ev.type === 'step.compensationStarted' ||
        ev.type === 'step.whenStarted' ||
        ev.type === 'step.idempotencyKeyRequested'
      ) {
        fresh.add(ev.step)
      }
    }
    planResume(env, state, resume, fresh)
  }
  out.push(...resume)
  // Every non-empty batch advances `seq`/`updatedAt` → persist (rejections and ignored results included).
  if (events.length > 0) out.push({ kind: 'persist', reason: final ? 'final' : 'change' })
  return out
}

function planEvent(env: MachineEnv, state: WizardState, ev: DomainEvent, out: Effect[]): void {
  switch (ev.type) {
    case 'transition.phase':
      planPhase(env, state, ev, out)
      return
    case 'transition.committed':
      out.push({
        kind: 'settle',
        txId: ev.txId,
        outcome: 'ok',
        value: { from: ev.from, to: ev.to },
      })
      return
    case 'transition.rejected':
      out.push({
        kind: 'settle',
        txId: ev.txId,
        outcome: 'rejected',
        error: {
          reason: ev.reason,
          ...(ev.step !== undefined ? { step: ev.step } : {}),
          ...(ev.issues !== undefined ? { issues: ev.issues } : {}),
        },
      })
      return
    case 'transition.failed':
      out.push({ kind: 'settle', txId: ev.txId, outcome: 'failed', error: ev.error })
      return
    case 'step.entered': {
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.runId !== ev.runId) return
      if (rec.entering === true) out.push(call(env, rec, 'enter', { extra: { from: ev.from } }))
      else planKindStart(env, state, rec, out)
      return
    }
    case 'step.enterCompleted': {
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.entering === true) return
      planKindStart(env, state, rec, out)
      return
    }
    case 'step.whenStarted': {
      // v0.2 (§10.2): the predicate runs while the step is still pending (token = current runId).
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status === 'active' || rec.when !== 'pending') return
      out.push(call(env, rec, 'when'))
      return
    }
    case 'step.idempotencyKeyRequested': {
      // v0.2 (§10.4): computed before the first attempt of the run (args = the run's args).
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.runId !== ev.runId) return
      if (rec.attempt !== 0 || rec.entering === true) return
      out.push(call(env, rec, 'idempotencyKey', { extra: { attempt: 1 } }))
      return
    }
    case 'step.mapErrorStarted': {
      // v0.2 (§10.7): the raw failure travels in `extra` and comes back on the result.
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'active' || rec.attempt !== ev.attempt) return
      if (rec.retryAt !== undefined || rec.entering === true) return
      out.push(
        call(env, rec, 'mapError', {
          attempt: ev.attempt,
          extra: {
            error: ev.error,
            attempt: ev.attempt,
            ...(ev.timedOut === true ? { timedOut: true } : {}),
            ...(ev.syncViolation === true ? { syncViolation: true } : {}),
          },
        }),
      )
      return
    }
    case 'step.runStarted': {
      const rec = state.steps[ev.step]
      if (
        rec === undefined ||
        rec.status !== 'active' ||
        rec.runId !== ev.runId ||
        rec.attempt !== ev.attempt
      )
        return
      if (rec.retryAt !== undefined || rec.entering === true) return
      const timeoutMs = env.def.steps[ev.step]?.timeoutMs
      out.push(
        call(env, rec, 'run', {
          attempt: ev.attempt,
          extra: { attempt: ev.attempt },
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      )
      return
    }
    case 'step.retryScheduled':
    case 'timer.scheduled': {
      const entry = state.timers[ev.timerId]
      if (entry !== undefined)
        out.push({ kind: 'timer.set', timerId: ev.timerId, at: entry.at, fire: entry.fire })
      return
    }
    case 'timer.cleared':
      out.push({ kind: 'timer.clear', timerId: ev.timerId })
      return
    case 'event.delivered': {
      const rec = state.steps[ev.to]
      if (rec === undefined || rec.status !== 'active' || rec.entering === true) return
      out.push(
        call(env, rec, 'on', {
          extra: { event: ev.event, payload: ev.payload, inboxId: ev.inboxId },
        }),
      )
      return
    }
    case 'event.flowDelivered':
      // v0.2 (§10.1): the flow-level handler has no step — `step: ''`, token `{ step: '', runId: 0 }`;
      // the executor and `decide` route on `hook: 'flowOn'` before looking at the step.
      out.push({
        kind: 'call',
        effectId: env.id('fx'),
        step: '',
        hook: 'flowOn',
        token: { step: '', runId: 0 },
        extra: { event: ev.event, payload: ev.payload, inboxId: ev.inboxId },
      })
      return
    case 'step.compensationStarted': {
      const rec = state.steps[ev.step]
      if (rec === undefined || rec.status !== 'compensating') return
      planCompensate(env, state, rec, out)
      return
    }
    case 'step.cancelled': {
      const rec = state.steps[ev.step]
      if (rec?.kind === 'flow') {
        out.push({
          kind: 'child.send',
          step: ev.step,
          command: { type: 'cancel', ...(ev.reason !== undefined ? { reason: ev.reason } : {}) },
        })
      }
      return
    }
    case 'child.started':
      out.push({ kind: 'child.create', step: ev.step, context: ev.context })
      return
    case 'child.summary': {
      const rec = state.steps[ev.step]
      if (ev.done === undefined || rec === undefined || rec.status !== 'active') return
      if (env.def.steps[ev.step]?.hooks.childOutput === undefined) return
      out.push(call(env, rec, 'childOutput', { extra: { output: ev.done.output } }))
      return
    }
    case 'child.command':
      out.push({ kind: 'child.send', step: ev.step, command: ev.command })
      return
    case 'flow.reset':
      for (const id of env.def.order)
        if (env.def.steps[id]?.kind === 'flow') out.push({ kind: 'child.dispose', step: id })
      return
    default:
      return
  }
}

function planPhase(
  env: MachineEnv,
  state: WizardState,
  ev: Extract<DomainEvent, { type: 'transition.phase' }>,
  out: Effect[],
): void {
  const nav = state.nav
  if (nav.phase !== ev.phase || nav.txId !== ev.txId) return
  const txId = ev.txId
  const from = nav.from != null ? state.steps[nav.from] : undefined
  const targets = nav.targets ?? []
  const to = targets[0] ?? null
  switch (ev.phase) {
    case 'parsingInput':
      if (from !== undefined) out.push(call(env, from, 'parseInput', { txId }))
      return
    case 'validating':
      if (from !== undefined)
        out.push(call(env, from, 'validate', { txId, extra: { input: from.output } }))
      return
    case 'canExit':
      if (from !== undefined) out.push(call(env, from, 'canExit', { txId, extra: { to } }))
      return
    case 'resolvingTarget':
      // A decision's targets are its output — unless it was skipped (v0.2): then its `next` hook is asked.
      if (
        from !== undefined &&
        (from.kind !== 'decision' || from.status === 'skipped') &&
        env.def.steps[from.id]?.next.kind === 'dynamic'
      ) {
        out.push(call(env, from, 'next', { txId, extra: { output: from.output } }))
      }
      return
    case 'canEnter':
      for (const t of nav.pendingSteps ?? []) {
        const rec = state.steps[t]
        if (rec !== undefined)
          out.push(call(env, rec, 'canEnter', { txId, extra: { from: nav.from ?? null } }))
      }
      return
    case 'exiting':
      if (from !== undefined)
        out.push(
          call(env, from, 'exit', { txId, extra: { to, direction: nav.direction ?? 'forward' } }),
        )
      return
    case 'entering':
      for (const t of nav.pendingSteps ?? []) {
        const rec = state.steps[t]
        if (rec !== undefined)
          out.push(call(env, rec, 'enter', { txId, extra: { from: nav.from ?? null } }))
      }
      return
    default:
      return
  }
}

/**
 * Kind-specific effects once a step is entered and its `enter` hook (if any) has resolved.
 * `resume` = re-issuing after a restart: a task still waiting for its `idempotencyKey` hook
 * (attempt 0) gets that call again (on a live entry the `step.idempotencyKeyRequested` event plans it).
 */
function planKindStart(
  env: MachineEnv,
  _state: WizardState,
  rec: StepRecord,
  out: Effect[],
  resume = false,
): void {
  const def = env.def.steps[rec.id]
  if (def === undefined) return
  switch (def.kind) {
    case 'decision':
      out.push(call(env, rec, 'next'))
      return
    case 'flow':
      if (rec.child === undefined) out.push(call(env, rec, 'childContext'))
      return
    case 'final':
      if (def.hooks.finalOutput !== undefined) out.push(call(env, rec, 'finalOutput'))
      return
    case 'task':
      if (resume && rec.attempt === 0 && def.hooks.idempotencyKey !== undefined)
        out.push(call(env, rec, 'idempotencyKey', { extra: { attempt: 1 } }))
      return
    default:
      // view: nothing; task: `step.runStarted` plans the run; wait: deliveries/timers are events.
      return
  }
}

/** Compensate the in-flight stack entry: token = entry runId, output = the entry's snapshot, bounded by a timeout. */
function planCompensate(env: MachineEnv, state: WizardState, rec: StepRecord, out: Effect[]): void {
  const inFlight = state.saga.inFlight
  if (inFlight === undefined || inFlight.step !== rec.id) return
  if (rec.kind === 'flow') {
    out.push({ kind: 'child.send', step: rec.id, command: { type: 'compensate' } })
    return
  }
  const entry = state.saga.stack.find((e) => e.step === inFlight.step && e.runId === inFlight.runId)
  const timeoutMs =
    env.def.steps[rec.id]?.timeoutMs ??
    env.def.policies.compensationGraceMs ??
    DEFAULT_COMPENSATION_GRACE_MS
  out.push(
    call(env, rec, 'compensate', {
      runId: inFlight.runId,
      timeoutMs,
      extra: { output: entry?.output, reason: state.saga.reason ?? null },
    }),
  )
}

/**
 * Resume: re-issue the hook calls that were in flight, then re-arm every timer
 * (overdue → now). Appended after the batch's other effects (see `plan`).
 */
function planResume(
  env: MachineEnv,
  state: WizardState,
  out: Effect[],
  fresh: ReadonlySet<string>,
): void {
  for (const id of state.active) {
    const rec = state.steps[id]
    if (rec === undefined || fresh.has(id)) continue
    if (rec.entering === true) {
      out.push(call(env, rec, 'enter', { extra: { from: null } }))
      continue
    }
    planKindStart(env, state, rec, out, true)
  }
  for (const id of Object.keys(state.steps)) {
    const rec = state.steps[id]
    if (rec === undefined || fresh.has(id)) continue
    if (rec.status === 'compensating') planCompensate(env, state, rec, out)
    // v0.2 (§10.2): a `when` predicate that was in flight is asked again.
    else if (rec.status !== 'active' && rec.when === 'pending') out.push(call(env, rec, 'when'))
  }
  const now = env.now()
  const timers = Object.entries(state.timers).sort((a, b) => a[1].at - b[1].at)
  for (const [timerId, entry] of timers) {
    out.push({ kind: 'timer.set', timerId, at: Math.max(entry.at, now), fire: entry.fire })
  }
}
