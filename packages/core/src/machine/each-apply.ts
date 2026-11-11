/** Fold map facts without copying the whole item table. */

import { toStepError, withStep, withTimer } from './apply/patch'
import { createEachState, eachItem, updateEachItem } from './each-state'
import type { DomainEvent } from './events'
import type { WizardState } from './state'
import { omit } from './util'

export function applyEach(state: WizardState, ev: DomainEvent): WizardState {
  if (ev.type === 'step.eachStarted')
    return withStep(state, ev.step, (rec) => ({
      ...rec,
      attempt: 1,
      each: createEachState(ev.items, ev.keys),
    }))
  if (ev.type === 'step.eachRetryScheduled') {
    const next = withStep(state, ev.step, (rec) => {
      if (rec.each === undefined) return rec
      return { ...rec, each: updateEachItem(rec.each, ev.index, { retryAt: ev.dueAt }) }
    })
    return withTimer(next, ev.timerId, {
      at: ev.dueAt,
      fire: { type: 'timer.fired', timerId: ev.timerId },
      purpose: 'retry',
      step: ev.step,
    })
  }
  if (!ev.type.startsWith('step.each')) return state
  if (!('step' in ev)) return state
  return withStep(state, ev.step, (rec) => {
    const each = rec.each
    if (each === undefined) return rec
    switch (ev.type) {
      case 'step.eachItemKeyed':
        return { ...rec, each: updateEachItem(each, ev.index, { idempotencyKey: ev.key }) }
      case 'step.eachItemStarted': {
        const before = eachItem(each, ev.index)
        const updated = updateEachItem(each, ev.index, {
          status: 'running',
          attempt: ev.attempt,
          retryAt: undefined,
          error: undefined,
          ...(ev.resumed === true ? {} : { child: undefined, output: undefined }),
        })
        return {
          ...rec,
          each: {
            ...updated,
            cursor: Math.max(each.cursor, ev.index + 1),
            running: each.running + (before.status === 'running' ? 0 : 1),
          },
        }
      }
      case 'step.eachItemCompleted': {
        const before = eachItem(each, ev.index)
        const updated = updateEachItem(each, ev.index, {
          status: 'done',
          output: ev.output,
          retryAt: undefined,
          error: undefined,
        })
        return {
          ...rec,
          each: {
            ...updated,
            running: each.running - (before.status === 'running' ? 1 : 0),
            done: each.done + (before.status === 'done' ? 0 : 1),
          },
        }
      }
      case 'step.eachItemFailed': {
        const before = eachItem(each, ev.index)
        const updated = updateEachItem(each, ev.index, {
          status: ev.willRetry ? 'retrying' : 'failed',
          error: toStepError(ev.error, ev.kind ?? 'run', ev.at, ev.attempt, ev.data),
        })
        return {
          ...rec,
          each: { ...updated, running: each.running - (before.status === 'running' ? 1 : 0) },
        }
      }
      case 'step.eachRetryRequested': {
        let next = each
        let cursor = each.cursor
        for (const index of ev.indices) {
          next = updateEachItem(next, index, {
            status: 'pending',
            ...(ev.resetAttempts === true
              ? { attempt: 0, generation: (eachItem(next, index).generation ?? 0) + 1 }
              : {}),
            retryAt: undefined,
            error: undefined,
          })
          cursor = Math.min(cursor, index)
        }
        return { ...omit(rec, ['error', 'endedAt']), status: 'active', each: { ...next, cursor } }
      }
      case 'step.eachChildSummary':
        return { ...rec, each: updateEachItem(each, ev.index, { child: ev.summary }) }
      case 'step.eachChildOutputRequested':
        return { ...rec, each: updateEachItem(each, ev.index, { output: ev.output }) }
      default:
        return rec
    }
  })
}
