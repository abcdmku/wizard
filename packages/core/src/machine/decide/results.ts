/**
 * Effect results (`res.ok` / `res.err`) → events: token checks first (§0), then the transaction
 * (`nav.ts`), the compensation entry (`saga.ts`), the flow-level handler or the step-level hook.
 * @internal
 */

import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import type { EffectResult } from '../commands'
import { onEachResult } from '../each-results'
import { completeStep, failCurrent } from '../nav'
import { nextTargetsError, onNavResult, runPhases } from '../nav-phases'
import { onCompensated, onCompensationFailed } from '../saga'
import {
  continueAfterInitial,
  currentIdempotencyKey,
  failStep,
  schedule,
  skipStep,
  startKind,
} from '../scheduler'
import { isRoutingStep, isRunnableStep, isTerminal, sameEntry } from '../selectors'
import { onSleepResult } from '../sleep'
import { stepIndex } from '../step-index'
import { normalizeTargets } from '../util'
import { onHandlerError, onHandlerResult } from '../wait'
import { deliveryCallStopped, deliveryStopped } from '../wait-correlation'
import { cmdCancel } from './commands'
import { onContextPatch } from './input'
import { onMapErrorResult, onRunResult } from './run-results'

export type ResultMsg = Extract<EffectResult, { type: 'res.ok' | 'res.err' }>

export function ignore(
  b: Batch,
  effectId: string,
  reason: 'stale' | 'cancelled' | 'unknown-step',
): void {
  emit(b, { type: 'result.ignored', effectId, reason })
}

/** Token checks first (§0), then route to the transaction or the step-level handler. */
export function onResult(b: Batch, msg: ResultMsg): void {
  const { token } = msg
  if (msg.hook === 'flowOn') {
    onFlowHandlerResult(b, msg)
    return
  }
  const r = rec(b, token.step)
  if (r === undefined) {
    ignore(b, msg.effectId, 'unknown-step')
    return
  }
  if (msg.hook === 'initial') {
    if (token.initialSeq === undefined || token.initialSeq !== r.initializing) {
      ignore(b, msg.effectId, 'stale')
      return
    }
    if (!onStepResult(b, msg)) ignore(b, msg.effectId, 'stale')
    return
  }
  if (msg.hook === 'compensate') {
    // The token identifies a stack ENTRY (step, runId of that completion), not the record's runId.
    const inFlight = b.state.saga.inFlight
    if (inFlight === undefined || !sameEntry(inFlight, token) || r.status !== 'compensating') {
      ignore(b, msg.effectId, 'stale')
      return
    }
    if (msg.type === 'res.ok') onCompensated(b, inFlight)
    else onCompensationFailed(b, inFlight, msg.error)
    return
  }
  if (token.runId !== r.runId) {
    ignore(b, msg.effectId, 'stale')
    return
  }
  if (msg.hook === 'each' || token.itemIndex !== undefined) {
    if (!onEachResult(b, msg)) ignore(b, msg.effectId, 'stale')
    return
  }
  if (token.attempt !== undefined && token.attempt !== r.attempt) {
    ignore(b, msg.effectId, 'stale')
    return
  }
  if (token.txId !== undefined) {
    if (b.state.nav.txId !== token.txId || !onNavResult(b, msg)) ignore(b, msg.effectId, 'stale')
    return
  }
  if (!onStepResult(b, msg))
    ignore(b, msg.effectId, r.status === 'cancelled' ? 'cancelled' : 'stale')
}

/** A handler call the runtime aborted (e.g. dropped unstarted after its delivery stopped). */
function handlerCancelled(msg: ResultMsg): boolean {
  return msg.type === 'res.err' && msg.cancelled === true
}

/**
 * v0.2 (§10.1): flow-level `on[event]` result. `{ cancel: reason }` cancels the flow like the
 * `cancel` command (compensation policy applies); a throw is recorded as `event.handlerFailed`.
 * Stale once the flow is idle again (reset), terminal or compensating, or when the runtime
 * aborted the call.
 */
function onFlowHandlerResult(b: Batch, msg: ResultMsg): void {
  const s = b.state
  if (
    s.status === 'idle' ||
    isTerminal(s) ||
    s.status === 'compensating' ||
    handlerCancelled(msg) ||
    deliveryCallStopped(s, msg.token)
  ) {
    ignore(b, msg.effectId, 'stale')
    return
  }
  const event = typeof msg.extra?.event === 'string' ? msg.extra.event : ''
  if (msg.type === 'res.err') {
    emit(b, { type: 'event.handlerFailed', event, error: msg.error })
    return
  }
  const value = msg.value
  const cancel =
    typeof value === 'object' && value !== null && 'cancel' in value ? value.cancel : undefined
  if (typeof cancel === 'string') cmdCancel(b, cancel)
}

function onStepResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined) return false
  const ok = msg.type === 'res.ok'
  const value = ok ? msg.value : undefined
  const errorKind = !ok && msg.syncViolation === true ? 'sync-violation' : 'hook'
  // A `strict: 'sync'` violation is a programmer error: the step fails as 'sync-violation' (plan §8.1).
  const fail = (kind: 'hook' | 'child') =>
    failStep(b, step, ok ? { name: 'Error', message: '' } : msg.error, ok ? kind : errorKind)
  switch (msg.hook) {
    case 'initial': {
      if (def.kind !== 'view' || r.initializing === undefined) return false
      if (!ok) {
        fail('hook')
        if (b.state.nav.phase === 'entering' && b.state.nav.pendingSteps?.includes(step))
          failCurrent(b, step, msg.error)
        return true
      }
      emit(b, { type: 'input.changed', step, patch: value, reset: false })
      if (b.state.nav.phase === 'entering') {
        if ((b.state.nav.pendingSteps?.length ?? 0) === 0) runPhases(b, 'entering')
      } else continueAfterInitial(b, step)
      return true
    }
    case 'enter':
      if (r.status !== 'active' || r.entering !== true) return false
      if (ok) {
        emit(b, { type: 'step.enterCompleted', step })
        startKind(b, step)
      } else fail('hook')
      return true
    case 'run':
      return onRunResult(b, msg)
    case 'sleep':
      return onSleepResult(b, msg)
    case 'when':
      // v0.2 (§10.2): only meaningful while the predicate is in flight for a pending activation
      // of a live flow (a terminal / compensating flow schedules nothing: the result is stale).
      if (r.status === 'active' || r.when !== 'pending' || !r.pendingActivation) return false
      if (isTerminal(b.state) || b.state.status === 'compensating') return false
      if (!ok) fail('hook')
      else if (value === false) {
        emit(b, { type: 'step.whenEvaluated', step, ok: false })
        skipStep(b, step, 'when')
      } else {
        emit(b, { type: 'step.whenEvaluated', step, ok: true })
        schedule(b)
      }
      return true
    case 'idempotencyKey': {
      // v0.2 (§10.4): the run starts with the custom key (a non-string value → default key).
      if (!isRunnableStep(def) || r.status !== 'active' || r.attempt !== 0 || r.entering === true)
        return false
      if (!ok) {
        fail('hook')
        return true
      }
      const key = typeof value === 'string' && value.length > 0 ? value : undefined
      emit(b, {
        type: 'step.runStarted',
        step,
        attempt: 1,
        runId: r.runId,
        idempotencyKey: key ?? currentIdempotencyKey(b, step, r.runId),
      })
      return true
    }
    case 'mapError':
      return onMapErrorResult(b, msg)
    case 'next':
      if (!isRoutingStep(def) || r.status !== 'active' || r.entering === true) return false
      if (!ok) fail('hook')
      else {
        const error = nextTargetsError(b, step, value)
        if (error !== undefined) failStep(b, step, error, 'hook')
        else completeStep(b, step, undefined, normalizeTargets(value))
      }
      return true
    case 'on': {
      // v0.2 (§10.1): any kind may handle events; the result contract depends on the kind.
      if (
        r.status !== 'active' ||
        r.entering === true ||
        handlerCancelled(msg) ||
        deliveryCallStopped(b.state, msg.token)
      )
        return false
      const failedBefore = stepIndex(b.state.steps).failed
      for (const patch of msg.updates ?? []) {
        onContextPatch(b, { type: 'context.patch', patch, by: step })
        if (deliveryStopped(b.state, failedBefore)) return true
      }
      if (ok) onHandlerResult(b, step, value, msg.extra ?? {})
      else onHandlerError(b, step, msg.error, errorKind, msg.extra ?? {})
      return true
    }
    case 'childContext':
      if (def.kind !== 'flow' || r.status !== 'active' || r.entering === true) return false
      if (ok)
        emit(b, { type: 'child.started', step, childPath: [...b.env.path, step], context: value })
      else fail('hook')
      return true
    case 'childOutput':
      if (def.kind !== 'flow' || r.status !== 'active') return false
      if (ok) completeStep(b, step, value)
      else fail('hook')
      return true
    default:
      return false
  }
}
