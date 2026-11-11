/** Failure, terminal, inbox, timer and identity checks for persisted state. @internal */

import type { CompiledFlow } from '../authoring/compiled'
import type {
  CompensationFailureState,
  FlowFailureState,
  TerminalState,
  TimerEntry,
} from '../machine/state'
import { decodeCommand } from './parse-command'
import {
  describe,
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInt,
  isRecord,
  isString,
} from './snapshot-checks'

type Rec = Record<string, unknown>

const TIMER_PURPOSES: ReadonlySet<string> = new Set<NonNullable<TimerEntry['purpose']>>([
  'retry',
  'sleep',
  'waitTimeout',
  'inboxTtl',
  'compensationGrace',
])
const FAILURE_KINDS =
  /^(?:validation|guard|run|typed|defect|timeout|compensate|interrupted|child|hook|sync-violation|runtime)$/

export function checkFailure(
  def: CompiledFlow,
  value: unknown,
  at: string,
  reasons: string[],
): value is FlowFailureState {
  if (!isRecord(value)) {
    reasons.push(`${at}: expected { step?, error }`)
    return false
  }
  if (value.step !== undefined && (!isString(value.step) || def.steps[value.step] === undefined)) {
    reasons.push(`${at}.step: unknown step ${describe(value.step)}`)
  }
  if (!isSerializedError(value.error)) reasons.push(`${at}.error: expected { name, message }`)
  if (value.kind !== undefined && (!isString(value.kind) || !FAILURE_KINDS.test(value.kind))) {
    reasons.push(`${at}.kind: unknown failure kind ${describe(value.kind)}`)
  }
  if (value.at !== undefined && !isFiniteNumber(value.at)) {
    reasons.push(`${at}.at: expected a number`)
  }
  if (value.attempt !== undefined && !isNonNegativeInt(value.attempt)) {
    reasons.push(`${at}.attempt: expected a non-negative integer`)
  }
  if (value.issues !== undefined && !Array.isArray(value.issues)) {
    reasons.push(`${at}.issues: expected an array`)
  }
  return true
}

export function checkTerminal(
  def: CompiledFlow,
  state: Rec,
  value: unknown,
  reasons: string[],
): value is TerminalState {
  const at = 'state.terminal'
  if (!isRecord(value)) {
    reasons.push(`${at}: expected { status }`)
    return false
  }
  if (value.status !== 'done' && value.status !== 'failed' && value.status !== 'cancelled') {
    reasons.push(`${at}.status: expected 'done' | 'failed' | 'cancelled'`)
  } else if (state.status !== value.status) {
    reasons.push(`${at}.status: does not match state.status '${String(state.status)}'`)
  }
  if (value.failure !== undefined) checkFailure(def, value.failure, `${at}.failure`, reasons)
  if (value.reason !== undefined && !isString(value.reason)) {
    reasons.push(`${at}.reason: expected a string`)
  }
  if (value.compensation !== undefined) {
    const c = value.compensation
    if (!isRecord(c)) reasons.push(`${at}.compensation: expected { outcome, failures }`)
    else {
      if (c.outcome !== 'completed' && c.outcome !== 'partial') {
        reasons.push(`${at}.compensation.outcome: expected 'completed' | 'partial'`)
      }
      if (!Array.isArray(c.failures)) {
        reasons.push(`${at}.compensation.failures: expected an array`)
      } else {
        c.failures.forEach((failure, i) => {
          checkCompensationFailure(def, failure, `${at}.compensation.failures[${i}]`, reasons)
        })
      }
    }
  }
  return true
}

function checkCompensationFailure(
  def: CompiledFlow,
  value: unknown,
  at: string,
  reasons: string[],
): value is CompensationFailureState {
  if (!isRecord(value)) {
    reasons.push(`${at}: expected { step, runId, error }`)
    return false
  }
  if (!isString(value.step) || def.steps[value.step] === undefined) {
    reasons.push(`${at}.step: unknown step ${describe(value.step)}`)
  }
  if (!isNonNegativeInt(value.runId)) reasons.push(`${at}.runId: expected a non-negative integer`)
  if (!isSerializedError(value.error)) reasons.push(`${at}.error: expected { name, message }`)
  return true
}

function isSerializedError(
  value: unknown,
): value is { readonly name: string; readonly message: string } {
  return isRecord(value) && isString(value.name) && isString(value.message)
}

export function checkInbox(def: CompiledFlow, state: Rec, reasons: string[]): void {
  if (!Array.isArray(state.inbox)) {
    reasons.push('state.inbox: expected an array')
    return
  }
  state.inbox.forEach((entry, i) => {
    const at = `state.inbox[${i}]`
    if (!isRecord(entry)) {
      reasons.push(`${at}: expected an object`)
      return
    }
    if (!isNonEmptyString(entry.id)) reasons.push(`${at}.id: expected a string`)
    if (!isString(entry.event)) reasons.push(`${at}.event: expected a string`)
    else if (def.events[entry.event] === undefined) {
      reasons.push(`${at}.event: unknown event '${entry.event}'`)
    }
    if (!isFiniteNumber(entry.at)) reasons.push(`${at}.at: expected a number`)
    if (!isFiniteNumber(entry.expiresAt)) reasons.push(`${at}.expiresAt: expected a number`)
  })
}

/** `state.eventIds` (D8): absent, or the remembered `{ id, at }` deliveries. */
export function checkEventIds(state: Rec, reasons: string[]): void {
  if (state.eventIds === undefined) return
  if (!Array.isArray(state.eventIds)) {
    reasons.push('state.eventIds: expected an array')
    return
  }
  state.eventIds.forEach((entry, i) => {
    if (!isRecord(entry) || !isNonEmptyString(entry.id) || !isFiniteNumber(entry.at))
      reasons.push(`state.eventIds[${i}]: expected { id, at }`)
  })
}

export function checkTimers(def: CompiledFlow, state: Rec, reasons: string[]): void {
  if (!isRecord(state.timers)) {
    reasons.push('state.timers: expected an object')
    return
  }
  for (const [id, timer] of Object.entries(state.timers)) {
    const at = `state.timers.${id}`
    if (!isRecord(timer) || !isFiniteNumber(timer.at)) {
      reasons.push(`${at}: expected { at, fire }`)
      continue
    }
    if (!isValidTimerFire(timer.fire, id)) {
      reasons.push(`${at}.fire: expected { type: 'timer.fired', timerId } or a valid command`)
    }
    if (timer.purpose !== undefined && !TIMER_PURPOSES.has(String(timer.purpose))) {
      reasons.push(`${at}.purpose: unknown purpose ${describe(timer.purpose)}`)
    }
    if (
      timer.step !== undefined &&
      (!isString(timer.step) || def.steps[timer.step] === undefined)
    ) {
      reasons.push(`${at}.step: unknown step ${describe(timer.step)}`)
    }
  }
}

/** `TimerEntry.fire` is either the internal `timer.fired` message for this id or a wire-valid command. */
function isValidTimerFire(fire: unknown, timerId: string): boolean {
  if (!isRecord(fire)) return false
  if (fire.type === 'timer.fired') {
    return fire.timerId === timerId && Object.keys(fire).length === 2
  }
  return decodeCommand(fire).ok
}

/** `seq` / `instanceId` / `epoch` / `flow` / `startedAt` / `updatedAt` of the state itself. */
export function checkIdentity(state: Rec, reasons: string[]): void {
  if (!isNonNegativeInt(state.seq)) reasons.push('state.seq: expected a non-negative integer')
  if (!isNonEmptyString(state.instanceId)) reasons.push('state.instanceId: expected a string')
  if (!isNonNegativeInt(state.epoch)) reasons.push('state.epoch: expected a non-negative integer')
  if (!isRecord(state.flow)) reasons.push('state.flow: expected { name, version }')
  if (state.startedAt !== null && !isFiniteNumber(state.startedAt)) {
    reasons.push('state.startedAt: expected a number or null')
  }
  if (!isFiniteNumber(state.updatedAt)) reasons.push('state.updatedAt: expected a number')
}
