/**
 * External events (§4.2 / plan §8.6 / §10.1): routing `send` to every active
 * step with a matching `on[event]` handler (v0.2: any kind, not only waits) and
 * to the flow-level handler, correlation filtering, inbox buffering + TTL,
 * drain-on-start (one oldest matching entry per drain — the "simple rule" of
 * §4.2), per-kind handler results and wait timeouts.
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import { completeStep, startEventTransition } from './nav'
import { clearStepTimers, failStep, inboxTimerId, waitTimerId } from './scheduler'
import type { InboxEntry, SerializedError } from './state'
import { unknownTarget } from './util'

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
    def.hooks.on?.[event] !== undefined &&
    (def.kind !== 'view' || b.state.nav.phase === 'idle')
  )
}

/** A view that would listen for `event` but is `nav`-busy right now (§10.1: keep the event buffered). */
function busyViewListener(b: Batch, event: string): boolean {
  if (b.state.nav.phase === 'idle') return false
  return b.state.active.some((id) => {
    const r = rec(b, id)
    const def = stepDef(b, id)
    return (
      r?.status === 'active' &&
      r.entering !== true &&
      def?.kind === 'view' &&
      def.hooks.on?.[event] !== undefined
    )
  })
}

/** v0.2: `correlate[event](payload)` — a throwing extractor counts as a mismatch. */
function correlationOf(b: Batch, event: string, payload: unknown): string | undefined | 'error' {
  const extract = b.env.def.correlate?.[event]
  if (extract === undefined) return undefined
  try {
    const value = extract(payload)
    return typeof value === 'string' ? value : undefined
  } catch {
    return 'error'
  }
}

/** `send{event, payload}` — the payload already passed the event boundary. */
export function routeEvent(
  b: Batch,
  event: string,
  payload: unknown,
  correlationId?: string,
): void {
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
  })
  // Correlation (§10.1): a mismatch with the wizard's id drops the event outright (no buffering).
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
  for (const to of targets) emit(b, { type: 'event.delivered', event, to, inboxId, payload })
  const flowHandled = b.env.def.on?.[event] !== undefined
  if (flowHandled) emit(b, { type: 'event.flowDelivered', event, inboxId, payload })
  const busyView = busyViewListener(b, event)
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

/** A handler result object (`{ next?, keep?, done?, fail? }`), or `undefined` for anything else. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * `res.ok(on)` — the RAW value the handler returned (the compiler does not touch it); the
 * contract is applied here, per kind (§10.1). Wait: `void | { keep } | { next } | { done } |
 * { fail }` (§4.2). View: `void`, or `{ next }` → an event transition (`cause: 'event'`) while
 * `nav` is idle, else `event.handlerResultIgnored { reason: 'nav-busy' }`; an unknown target
 * fails the step (`UNKNOWN_STEP`); anything else is ignored (`reason: 'kind'`). Task / decision /
 * flow / final: `void` only — every other value is ignored (`reason: 'kind'`).
 */
export function onHandlerResult(
  b: Batch,
  step: string,
  value: unknown,
  delivered: { readonly event?: string; readonly payload?: unknown },
): void {
  const def = stepDef(b, step)
  if (def === undefined) return
  if (def.kind === 'wait') {
    onWaitHandlerResult(b, step, asObject(value), delivered)
    return
  }
  const event = typeof delivered.event === 'string' ? delivered.event : ''
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
  result: Record<string, unknown> | undefined,
  delivered: { readonly event?: string; readonly payload?: unknown },
): void {
  if (result?.keep === true) {
    drainInbox(b, step)
    return
  }
  if (typeof result?.fail === 'string') {
    failStep(b, step, { name: 'Error', message: result.fail }, 'hook')
    return
  }
  // `{ next }`: a single id overriding the static `next`; `null` / `undefined` = no override.
  const next = result?.next ?? undefined
  if (next !== undefined && (typeof next !== 'string' || stepDef(b, next) === undefined)) {
    failUnknownTarget(b, step, next)
    return
  }
  const output =
    result !== undefined && 'done' in result
      ? result.done
      : { event: delivered.event, payload: delivered.payload }
  clearStepTimers(b, step)
  completeStep(b, step, output, next)
}

/**
 * `res.err(on)` — a wait handler failure fails the step (v0.1); every other kind records
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
  if (def?.kind === 'wait') {
    failStep(b, step, error, kind)
    return
  }
  emit(b, {
    type: 'event.handlerFailed',
    step,
    event: typeof delivered.event === 'string' ? delivered.event : '',
    error,
  })
  drainInbox(b, step)
}

/** `waitTimeout` timer fired for an active wait. */
export function onWaitTimeout(b: Batch, step: string): void {
  const def = stepDef(b, step)
  if (def?.waitTimeout === undefined) return
  completeStep(b, step, { event: 'timeout' }, def.waitTimeout.next)
}
