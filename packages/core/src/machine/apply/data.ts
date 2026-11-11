/**
 * Reducers for data (`input.changed` / `context.changed`), external events (`event.*`), timers
 * (`timer.*`) and child (`child.*`) events.
 * @internal
 */

import { rememberEventId } from '../event-ids'
import type { DomainEvent } from '../events'
import { issuesAfterInputPatch } from '../input-issues'
import type { InboxEntry, TimerEntry, WizardState } from '../state'
import type { MachineEnv } from '../types'
import { isPlainObject, omit } from '../util'
import { patchStep, withoutInbox, withoutTimer, withStep, withTimer } from './patch'

function clearTimerOwner(state: WizardState, entry: TimerEntry | undefined): WizardState {
  if (entry?.step === undefined) return state
  if (entry.purpose === 'retry') return patchStep(state, entry.step, {}, ['retryAt'])
  if (entry.purpose === 'waitTimeout' || entry.purpose === 'sleep')
    return patchStep(state, entry.step, {}, ['deadline'])
  return state
}

export function applyData(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'input.changed': {
      let next = withStep(state, ev.step, (rec) => {
        const cleared = omit(rec, ['issues', 'input', 'initializing'])
        if (ev.reset === true) {
          const def = env.def.steps[ev.step]
          if (def?.hooks.initial !== undefined) return { ...cleared, initializing: ev.seq }
          return def?.initial !== undefined ? { ...cleared, input: def.initial } : cleared
        }
        const issues = issuesAfterInputPatch(rec.issues, ev.patch)
        const base = issues === undefined ? cleared : { ...cleared, issues }
        if (isPlainObject(ev.patch)) {
          return { ...base, input: { ...(isPlainObject(rec.input) ? rec.input : {}), ...ev.patch } }
        }
        return ev.patch !== undefined ? { ...base, input: ev.patch } : base
      })
      if (
        ev.reset === false &&
        next.nav.phase === 'entering' &&
        next.nav.pendingSteps?.includes(ev.step)
      ) {
        next = {
          ...next,
          nav: {
            ...next.nav,
            pendingSteps: next.nav.pendingSteps.filter((step) => step !== ev.step),
          },
        }
      }
      return next
    }
    case 'context.changed':
      if (!isPlainObject(ev.patch)) return state
      return {
        ...state,
        context: { ...(isPlainObject(state.context) ? state.context : {}), ...ev.patch },
      }
    case 'event.received':
      if (ev.eventId === undefined) return state
      return { ...state, eventIds: rememberEventId(env, state.eventIds, ev.eventId, ev.at) }
    case 'event.buffered': {
      const entry: InboxEntry = {
        id: ev.inboxId,
        event: ev.event,
        payload: ev.payload,
        at: ev.at,
        expiresAt: ev.expiresAt,
      }
      return { ...state, inbox: [...state.inbox, entry] }
    }
    case 'event.delivered':
    case 'event.expired':
      return withoutInbox(state, ev.inboxId)
    case 'timer.scheduled': {
      const entry: TimerEntry = {
        at: ev.dueAt,
        fire: { type: 'timer.fired', timerId: ev.timerId },
        purpose: ev.purpose,
        ...(ev.step !== undefined ? { step: ev.step } : {}),
      }
      let next = withTimer(state, ev.timerId, entry)
      if ((ev.purpose === 'waitTimeout' || ev.purpose === 'sleep') && ev.step !== undefined)
        next = patchStep(next, ev.step, { deadline: ev.dueAt })
      return next
    }
    case 'timer.fired':
    case 'timer.cleared':
      return withoutTimer(clearTimerOwner(state, state.timers[ev.timerId]), ev.timerId)
    case 'child.summary':
      return withStep(state, ev.step, (rec) => ({
        ...rec,
        child: ev.summary,
        ...(ev.done !== undefined ? { output: ev.done.output } : {}),
      }))
    default:
      return state
  }
}
