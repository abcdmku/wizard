/** External-event routing, inbox draining, handler results and wait timeouts. @internal */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import type { Command } from './commands'
import { completeStep, startAuto, startEventTransition } from './nav'
import { activateFeeds, propagateSkipped } from './needs'
import { clearStepTimers, failStep, inboxTimerId, schedule, waitTimerId } from './scheduler'
import { isEventStep } from './selectors'
import type { InboxEntry, SerializedError } from './state'
import { unknownTarget } from './util'
import { correlationOf } from './wait-correlation'

/**
 * A step is listening for `event` when active, past its `enter` hook, and has a handler.
 * A view listens only while `nav` is idle (a `{ next }` result needs an idle `nav`; events that
 * arrive while it is busy stay buffered until `onNavIdle` drains them).
 */
function listening(b: Batch, step: string, event: string): boolean {
  const r = rec(b, step)
  const def = stepDef(b, step)
  return (
    r !== undefined &&
    def !== undefined &&
    r.status === 'active' &&
    r.entering !== true &&
    (def.hooks.waitFor?.[event] ?? def.hooks.on?.[event]) !== undefined &&
    (def.kind !== 'view' || b.state.nav.phase === 'idle')
  )
}

function busyViewListener(b: Batch, event: string): boolean {
  if (b.state.nav.phase === 'idle') return false
  return b.state.active.some((id) => {
    const r = rec(b, id)
    const def = stepDef(b, id)
    return (
      r?.status === 'active' &&
      r.entering !== true &&
      def?.kind === 'view' &&
      (def.hooks.waitFor?.[event] ?? def.hooks.on?.[event]) !== undefined
    )
  })
}

/** `send{event, payload}` — the payload already passed the event boundary. */
export function routeEvent(b: Batch, cmd: Extract<Command, { type: 'send' }>): void {
  const { event, payload, correlationId, eventId } = cmd
  const inboxId = b.env.id('evt')
  const extracted = correlationOf(b, event, payload)
  const effective =
    correlationId ?? (extracted !== undefined && extracted !== 'error' ? extracted : undefined)
  emit(b, {
    type: 'event.received',
    event,
    payload,
    inboxId,
    ...(effective !== undefined ? { correlationId: effective } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
  })
  // Correlation (§10.1): a mismatch with the run's id drops the event outright (no buffering).
  const own = b.state.correlationId
  if (
    extracted !== undefined &&
    own !== undefined &&
    (extracted === 'error' || extracted !== own)
  ) {
    emit(b, { type: 'event.dropped', event, reason: 'correlation' })
    return
  }
  const targets = b.state.active.filter((id) => listening(b, id, event))
  for (const to of targets) {
    emit(b, { type: 'event.delivered', event, to, inboxId, payload })
  }
  const flowHandled = b.env.def.on?.[event] !== undefined
  const busyView = busyViewListener(b, event)
  if (flowHandled) emit(b, { type: 'event.flowDelivered', event, inboxId, payload })
  if (targets.length > 0 || (flowHandled && !busyView)) return
  const policy = b.env.def.policies.unmatchedEvents
  // Nothing (or only the flow) handled it: buffer per policy — always when a busy view would have.
  if (policy.buffer || busyView) {
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
  const now = b.env.now()
  for (const entry of b.state.inbox) if (entry.expiresAt <= now) expireEntry(b, entry.id)
}

export function expireEntry(b: Batch, inboxId: string): void {
  const entry = b.state.inbox.find((e) => e.id === inboxId)
  if (entry === undefined) return
  const timerId = inboxTimerId(inboxId)
  if (timerId in b.state.timers) emit(b, { type: 'timer.cleared', timerId })
  emit(b, { type: 'event.expired', event: entry.event, inboxId })
}

/** Deliver the oldest buffered entry this step handles (if any). Returns true when one was delivered. */
export function drainInbox(b: Batch, step: string): boolean {
  expireInbox(b)
  if (stepDef(b, step) === undefined) return false
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

/** Start an event-driven step: drain the inbox, then arm the timeout. */
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

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** Apply the kind-specific contract of a step-level event handler result. */
export function onHandlerResult(
  b: Batch,
  step: string,
  value: unknown,
  delivered: { readonly event?: string; readonly payload?: unknown },
): void {
  const def = stepDef(b, step)
  if (def === undefined) return
  const event = typeof delivered.event === 'string' ? delivered.event : ''
  if (isEventStep(def) && def.hooks.waitFor[event] !== undefined) {
    onWaitHandlerResult(b, step, value, delivered)
    return
  }
  const next = def.kind === 'view' ? asObject(value)?.next : undefined
  if (next !== undefined && next !== null) {
    if (typeof next !== 'string' || stepDef(b, next) === undefined) {
      failUnknownTarget(b, step, next)
      return
    }
    if (b.state.nav.phase === 'idle') {
      startEventTransition(b, step, next)
      return
    }
    emit(b, { type: 'event.handlerResultIgnored', step, event, reason: 'nav-busy' })
  } else if (value !== undefined && value !== null && !isVoidViewResult(def.kind, value)) {
    emit(b, { type: 'event.handlerResultIgnored', step, event, reason: 'kind' })
  }
  // Still listening: the next buffered entry (if any) is delivered.
  drainInbox(b, step)
}

/** A view's `{}` / `{ next: null }` means "nothing" (the typed contract allows it). */
function isVoidViewResult(kind: string, value: unknown): boolean {
  const result = asObject(value)
  return kind === 'view' && result !== undefined && Object.keys(result).every((k) => k === 'next')
}

function failUnknownTarget(b: Batch, step: string, target: unknown): void {
  failStep(b, step, unknownTarget(target), 'hook')
}

function onWaitHandlerResult(
  b: Batch,
  step: string,
  value: unknown,
  delivered: { readonly event?: string; readonly payload?: unknown },
): void {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'next' in value
  ) {
    failStep(
      b,
      step,
      {
        name: 'WizardError',
        code: 'INVALID_WAIT_RESULT',
        message: `waitFor handler of '${step}' cannot return 'next'; configure next on the step`,
      },
      'hook',
    )
    return
  }
  const result = asObject(value)
  if (result?.keep === true) {
    drainInbox(b, step)
    return
  }
  if (typeof result?.fail === 'string') {
    failStep(b, step, { name: 'Error', message: result.fail }, 'hook')
    return
  }
  const output = result !== undefined && 'done' in result ? result.done : delivered.payload
  clearStepTimers(b, step)
  completeStep(b, step, output)
}

/**
 * `res.err(on)` — a `waitFor` handler failure fails the step; passive handlers record
 * `event.handlerFailed { step, event, error }` and keeps going (the step's own work is unaffected).
 */
export function onHandlerError(
  b: Batch,
  step: string,
  error: SerializedError,
  kind: 'hook' | 'sync-violation',
  delivered: { readonly event?: string },
): void {
  const def = stepDef(b, step)
  const event = typeof delivered.event === 'string' ? delivered.event : ''
  if (isEventStep(def) && def.hooks.waitFor[event] !== undefined) {
    failStep(b, step, error, kind)
    return
  }
  emit(b, {
    type: 'event.handlerFailed',
    step,
    event,
    error,
  })
  drainInbox(b, step)
}

/**
 * `waitTimeout` timer fired for an active event-driven step. The wait produced no output, so it
 * is skipped (`timeout`): steps that need it follow, its `next` is not taken and `timeout.next`
 * arrives instead.
 */
export function onWaitTimeout(b: Batch, step: string): void {
  const next = stepDef(b, step)?.waitTimeout?.next
  if (next === undefined) return
  emit(b, { type: 'step.skipped', step, reason: 'timeout', next })
  activateFeeds(b, step)
  propagateSkipped(b, [step])
  startAuto(b, step, next)
  schedule(b)
}
