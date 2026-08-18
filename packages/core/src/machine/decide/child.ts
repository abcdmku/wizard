/**
 * `res.child` (§7): a child flow's summary / completion / failure reported by the child bridge.
 * @internal
 */

import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import type { EffectResult } from '../commands'
import { completeStep } from '../nav'
import { onCompensated } from '../saga'
import { failStep } from '../scheduler'
import type { WizardStatus } from '../state'
import { ignore } from './results'

const CHILD_TERMINAL: ReadonlySet<WizardStatus> = new Set(['done', 'failed', 'cancelled'])

export function onChildResult(b: Batch, msg: Extract<EffectResult, { type: 'res.child' }>): void {
  const r = rec(b, msg.step)
  const def = stepDef(b, msg.step)
  const effectId = `child:${msg.step}`
  if (r === undefined || def === undefined) {
    ignore(b, effectId, 'unknown-step')
    return
  }
  // Freshness: right kind, the parent runId the child was created under, increasing summary seq.
  if (def.kind !== 'flow' || msg.token.step !== msg.step || msg.token.runId !== r.runId) {
    ignore(b, effectId, 'stale')
    return
  }
  if (r.child !== undefined && msg.summary.seq <= r.child.seq) {
    ignore(b, effectId, 'stale')
    return
  }
  if (r.status === 'compensating') {
    // Only an explicit compensation completion (or a failed/cancelled child) ends the entry;
    // a child that reports `done` while the parent unwinds is not a success.
    const inFlight = b.state.saga.inFlight
    const finished =
      msg.phase === 'compensated' ||
      msg.summary.status === 'failed' ||
      msg.summary.status === 'cancelled'
    if (finished && inFlight !== undefined && inFlight.step === msg.step) onCompensated(b, inFlight)
    return
  }
  if (r.status !== 'active') return
  const first = r.child === undefined || !CHILD_TERMINAL.has(r.child.status)
  emit(b, {
    type: 'child.summary',
    step: msg.step,
    summary: msg.summary,
    ...(first && msg.done !== undefined ? { done: msg.done } : {}),
  })
  if (!first) return
  if (msg.done !== undefined) {
    if (stepDef(b, msg.step)?.hooks.childOutput === undefined)
      completeStep(b, msg.step, msg.done.output)
    return
  }
  if (msg.failed !== undefined) failStep(b, msg.step, msg.failed.error, 'child')
}
