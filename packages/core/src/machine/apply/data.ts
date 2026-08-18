/**
 * Reducers for data (`input.changed` / `context.changed`), external events (`event.*`), timers
 * (`timer.*`) and child (`child.*`) events.
 * @internal
 */

import type { DomainEvent } from '../events'
import type { InboxEntry, TimerEntry, WizardState } from '../state'
import type { MachineEnv } from '../types'
import { isPlainObject, omit } from '../util'
import { patchStep, withoutInbox, withoutTimer, withStep, withTimer } from './patch'

export function applyData(env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'input.changed':
      return withStep(state, ev.step, (rec) => {
        const base = omit(rec, ['issues', 'input'])
        if (ev.reset === true) {
          const initial = env.def.steps[ev.step]?.initial
          return initial !== undefined ? { ...base, input: initial } : base
        }
        if (isPlainObject(ev.patch)) {
          return { ...base, input: { ...(isPlainObject(rec.input) ? rec.input : {}), ...ev.patch } }
        }
        return ev.patch !== undefined ? { ...base, input: ev.patch } : base
      })
    case 'context.changed':
      if (!isPlainObject(ev.patch)) return state
      return {
        ...state,
        context: { ...(isPlainObject(state.context) ? state.context : {}), ...ev.patch },
      }
    default:
      return state
  }
}

export function applyEvents(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
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
    case 'event.received':
    case 'event.rejected':
    case 'event.dropped':
    case 'event.flowDelivered':
    case 'event.handlerResultIgnored':
    case 'event.handlerFailed':
      return state
    default:
      return state
  }
}

function clearTimerOwner(state: WizardState, entry: TimerEntry | undefined): WizardState {
  if (entry?.step === undefined) return state
  if (entry.purpose === 'retry') return patchStep(state, entry.step, {}, ['retryAt'])
  if (entry.purpose === 'waitTimeout') return patchStep(state, entry.step, {}, ['deadline'])
  return state
}

export function applyTimers(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'timer.scheduled': {
      const entry: TimerEntry = {
        at: ev.dueAt,
        fire: { type: 'timer.fired', timerId: ev.timerId },
        purpose: ev.purpose,
        ...(ev.step !== undefined ? { step: ev.step } : {}),
      }
      let next = withTimer(state, ev.timerId, entry)
      if (ev.purpose === 'waitTimeout' && ev.step !== undefined)
        next = patchStep(next, ev.step, { deadline: ev.dueAt })
      return next
    }
    case 'timer.fired':
    case 'timer.cleared':
      return withoutTimer(clearTimerOwner(state, state.timers[ev.timerId]), ev.timerId)
    default:
      return state
  }
}

export function applyChild(_env: MachineEnv, state: WizardState, ev: DomainEvent): WizardState {
  switch (ev.type) {
    case 'child.summary':
      return withStep(state, ev.step, (rec) => ({
        ...rec,
        child: ev.summary,
        ...(ev.done !== undefined ? { output: ev.done.output } : {}),
      }))
    case 'child.started':
    case 'child.command':
      return state
    default:
      return state
  }
}
