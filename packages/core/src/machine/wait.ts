/**
 * Waits and external events (§4.2 / plan §8.6): routing `send` to active wait
 * steps, inbox buffering + TTL, drain-on-enter (one oldest matching entry per
 * drain — the "simple rule" of §4.2), wait timeouts.
 *
 * @internal
 */

import type { OnHandlerResult } from '../authoring/compiled'
import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import { completeStep } from './nav'
import { clearStepTimers, failStep, inboxTimerId, waitTimerId } from './scheduler'
import { expiredInbox } from './selectors'
import type { InboxEntry } from './state'

/** A wait step is listening for `event` when active, past its `enter` hook, and has a handler. */
function listening(b: Batch, step: string, event: string): boolean {
  const r = rec(b, step)
  const def = stepDef(b, step)
  return (
    r !== undefined &&
    def !== undefined &&
    def.kind === 'wait' &&
    r.status === 'active' &&
    r.entering !== true &&
    def.hooks.on?.[event] !== undefined
  )
}

/** `send{event, payload}` — the payload already passed the event boundary. */
export function routeEvent(
  b: Batch,
  event: string,
  payload: unknown,
  correlationId?: string,
): void {
  const inboxId = b.env.id('evt')
  emit(b, {
    type: 'event.received',
    event,
    payload,
    inboxId,
    ...(correlationId !== undefined ? { correlationId } : {}),
  })
  const targets = b.state.active.filter((id) => listening(b, id, event))
  if (targets.length > 0) {
    for (const to of targets) emit(b, { type: 'event.delivered', event, to, inboxId, payload })
    return
  }
  const policy = b.env.def.policies.unmatchedEvents
  if (policy.buffer) {
    const expiresAt = b.env.now() + policy.ttlMs
    emit(b, { type: 'event.buffered', event, inboxId, expiresAt, payload })
    emit(b, {
      type: 'timer.scheduled',
      timerId: inboxTimerId(inboxId),
      dueAt: expiresAt,
      purpose: 'inboxTtl',
    })
    return
  }
  emit(b, { type: 'event.dropped', event, reason: 'no-listener' })
}

/** Lazily drop expired inbox entries (their TTL timers are cleared too). */
export function expireInbox(b: Batch): void {
  for (const id of expiredInbox(b.state, b.env.now())) expireEntry(b, id)
}

export function expireEntry(b: Batch, inboxId: string): void {
  const entry = b.state.inbox.find((e) => e.id === inboxId)
  if (entry === undefined) return
  const timerId = inboxTimerId(inboxId)
  if (timerId in b.state.timers) emit(b, { type: 'timer.cleared', timerId })
  emit(b, { type: 'event.expired', event: entry.event, inboxId })
}

/** Deliver the oldest buffered entry this wait step handles (if any). Returns true when one was delivered. */
export function drainInbox(b: Batch, step: string): boolean {
  expireInbox(b)
  const def = stepDef(b, step)
  if (def === undefined) return false
  const entry: InboxEntry | undefined = b.state.inbox.find((e) => listening(b, step, e.event))
  if (entry === undefined) return false
  const timerId = inboxTimerId(entry.id)
  if (timerId in b.state.timers) emit(b, { type: 'timer.cleared', timerId })
  emit(b, {
    type: 'event.delivered',
    event: entry.event,
    to: step,
    inboxId: entry.id,
    payload: entry.payload,
  })
  return true
}

/** Kind-specific start for a wait step: drain the inbox, then arm the timeout. */
export function startWait(b: Batch, step: string): void {
  drainInbox(b, step)
  armWaitTimeout(b, step)
}

function armWaitTimeout(b: Batch, step: string): void {
  const def = stepDef(b, step)
  const r = rec(b, step)
  if (def?.waitTimeout === undefined || r === undefined || r.status !== 'active') return
  const timerId = waitTimerId(step)
  if (timerId in b.state.timers) return
  emit(b, {
    type: 'timer.scheduled',
    timerId,
    dueAt: b.env.now() + def.waitTimeout.afterMs,
    purpose: 'waitTimeout',
    step,
  })
}

/** `res.ok(on)` — value: `{ next?, keep?, done?, fail? } | void`. */
export function onHandlerResult(
  b: Batch,
  step: string,
  value: OnHandlerResult,
  delivered: { readonly event?: string; readonly payload?: unknown },
): void {
  const result = value ?? undefined
  if (result !== undefined && result.keep === true) {
    drainInbox(b, step)
    return
  }
  if (result !== undefined && typeof result.fail === 'string') {
    failStep(b, step, { name: 'Error', message: result.fail }, 'hook')
    return
  }
  const next = result?.next
  if (next !== undefined && b.env.def.steps[next] === undefined) {
    failStep(
      b,
      step,
      { name: 'WizardError', message: `unknown next target '${next}'`, code: 'UNKNOWN_STEP' },
      'hook',
    )
    return
  }
  const output =
    result !== undefined && 'done' in result
      ? result.done
      : { event: delivered.event, payload: delivered.payload }
  clearStepTimers(b, step)
  completeStep(b, step, output, next)
}

/** `waitTimeout` timer fired for an active wait. */
export function onWaitTimeout(b: Batch, step: string): void {
  const def = stepDef(b, step)
  if (def?.waitTimeout === undefined) return
  completeStep(b, step, { event: 'timeout' }, def.waitTimeout.next)
}
