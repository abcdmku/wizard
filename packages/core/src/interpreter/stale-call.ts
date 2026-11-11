/**
 * Whether a queued hook call's token no longer names the live step run, attempt, transaction or
 * initializer — the token checks `decide` applies to its result (machine/decide/results.ts) — or
 * is a handler call of a `send` whose delivery stopped before its turn (R6). Every one of those
 * only moves forward, so a call stale when its turn comes would have its result ignored: the
 * interpreter reports it aborted instead of running its side effect.
 * `wizardOn` and `compensate` calls carry no step-run token and are otherwise never stale here.
 * @internal
 */

import { eachItem } from '../machine/each-state'
import type { CallEffect } from '../machine/effects'
import type { WizardState } from '../machine/state'
import { deliveryCallStopped } from '../machine/wait-correlation'

export function isStaleCall(state: WizardState, effect: CallEffect): boolean {
  if (deliveryCallStopped(state, effect.token)) return true
  if (effect.hook === 'wizardOn' || effect.hook === 'compensate') return false
  const { token } = effect
  const rec = state.steps[token.step]
  if (rec === undefined) return true
  if (effect.hook === 'initial') return token.initialSeq !== rec.initializing
  if (token.runId !== rec.runId) return true
  if (token.itemIndex !== undefined) {
    if (rec.status !== 'active' || rec.each === undefined) return true
    const item = eachItem(rec.each, token.itemIndex)
    return (
      item.status !== 'running' ||
      item.attempt !== token.attempt ||
      (item.generation ?? 0) !== (token.itemGeneration ?? 0)
    )
  }
  if (token.attempt !== undefined && token.attempt !== rec.attempt) return true
  return token.txId !== undefined && token.txId !== state.nav.txId
}
