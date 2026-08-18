/**
 * Structural checks of a persisted `WizardState` against its compiled flow (plan §8.8): step
 * set, statuses and their invariants, cursor / history, nav, saga, inbox, timers and the
 * envelope fields. Every problem is a human-readable reason; nothing here runs user code.
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { NavPhase, SagaEntry, SagaEntryRef, StepStatus, TimerEntry } from '../machine/state'
import { decodeCommand } from './parse-command'
import {
  describe,
  isFiniteNumber,
  isNonEmptyString,
  isNonNegativeInt,
  isRecord,
  isString,
  isStringArray,
} from './snapshot-checks'

type Rec = Record<string, unknown>

const WIZARD_STATUSES: ReadonlySet<string> = new Set<string>([
  'idle',
  'running',
  'waiting',
  'done',
  'failed',
  'compensating',
  'cancelled',
])

const STEP_STATUSES: ReadonlySet<string> = new Set<StepStatus>([
  'idle',
  'active',
  'done',
  'failed',
  'skipped',
  'cancelled',
  'compensating',
  'compensated',
])

const NAV_PHASES: ReadonlySet<string> = new Set<NavPhase>([
  'idle',
  'parsingInput',
  'validating',
  'canExit',
  'resolvingTarget',
  'canEnter',
  'exiting',
  'entering',
])

const TIMER_PURPOSES: ReadonlySet<string> = new Set<NonNullable<TimerEntry['purpose']>>([
  'retry',
  'waitTimeout',
  'inboxTtl',
  'compensationGrace',
])

/** Every check over `state` (an object); reasons are prefixed `state.…`. */
export function checkState(def: CompiledFlow, state: Rec, reasons: string[]): void {
  if (!isString(state.status) || !WIZARD_STATUSES.has(state.status)) {
    reasons.push(`state.status: unknown status ${describe(state.status)}`)
  }
  if (!isRecord(state.steps)) {
    reasons.push('state.steps: expected an object')
    return
  }
  checkStepSet(def, state.steps, reasons)
  const active = checkActive(state, state.steps, reasons)
  checkStepRecords(def, state.steps, active, reasons)
  checkCursor(def, state, state.steps, reasons)
  checkStatusInvariants(def, state, active, reasons)
  checkNav(def, state, reasons)
  if (state.correlationId !== undefined && !isString(state.correlationId)) {
    reasons.push('state.correlationId: expected a string')
  }
  if (!isRecord(state.saga)) reasons.push('state.saga: expected an object')
  else checkSaga(def, state.saga, reasons)
  checkInbox(def, state, reasons)
  checkTimers(def, state, reasons)
  checkIdentity(state, reasons)
}

/** `state.active`: an array of distinct known step ids. Returns the set (partial on problems). */
function checkActive(state: Rec, steps: Rec, reasons: string[]): ReadonlySet<string> {
  const active = new Set<string>()
  if (!Array.isArray(state.active)) {
    reasons.push('state.active: expected an array')
    return active
  }
  for (const id of state.active) {
    if (!isString(id) || !Object.hasOwn(steps, id))
      reasons.push(`state.active: unknown step ${describe(id)}`)
    else if (active.has(id)) reasons.push(`state.active: duplicate entry '${id}'`)
    else active.add(id)
  }
  return active
}

/** Step-set equality with the definition. */
function checkStepSet(def: CompiledFlow, steps: Rec, reasons: string[]): void {
  const expected = new Set(def.order)
  for (const id of def.order)
    if (!Object.hasOwn(steps, id)) reasons.push(`state.steps: missing step '${id}'`)
  for (const id of Object.keys(steps))
    if (!expected.has(id)) reasons.push(`state.steps: unknown step '${id}'`)
}

/** Every record's shape and its status ↔ `state.active` link. */
function checkStepRecords(
  def: CompiledFlow,
  steps: Rec,
  active: ReadonlySet<string>,
  reasons: string[],
): void {
  for (const [id, rec] of Object.entries(steps)) {
    const stepDef = def.steps[id]
    if (stepDef === undefined) continue
    const at = `state.steps.${id}`
    if (!isRecord(rec)) {
      reasons.push(`${at}: expected an object`)
      continue
    }
    if (rec.id !== id) reasons.push(`${at}.id: expected '${id}'`)
    if (rec.kind !== stepDef.kind) {
      reasons.push(`${at}.kind: expected '${stepDef.kind}', got ${describe(rec.kind)}`)
    }
    if (!isString(rec.status) || !STEP_STATUSES.has(rec.status)) {
      reasons.push(`${at}.status: unknown status ${describe(rec.status)}`)
    } else {
      const listed = active.has(id)
      if (rec.status === 'active' && !listed)
        reasons.push(`${at}: active but missing from state.active`)
      if (rec.status !== 'active' && listed)
        reasons.push(`${at}: listed in state.active but status is '${rec.status}'`)
    }
    if (!isNonNegativeInt(rec.attempt))
      reasons.push(`${at}.attempt: expected a non-negative integer`)
    if (!isNonNegativeInt(rec.runId)) reasons.push(`${at}.runId: expected a non-negative integer`)
    if (!isNonNegativeInt(rec.visitedCount))
      reasons.push(`${at}.visitedCount: expected a non-negative integer`)
    if (typeof rec.pendingActivation !== 'boolean')
      reasons.push(`${at}.pendingActivation: expected a boolean`)
    if (!isRecord(rec.guards)) reasons.push(`${at}.guards: expected an object`)
    if (rec.when !== undefined && rec.when !== 'pending' && rec.when !== 'passed')
      reasons.push(`${at}.when: expected 'pending' | 'passed', got ${describe(rec.when)}`)
    if (rec.skipReason !== undefined && !isString(rec.skipReason))
      reasons.push(`${at}.skipReason: expected a string`)
  }
}

/** `state.current` is an active view (or null); `state.history` lists views only. */
function checkCursor(def: CompiledFlow, state: Rec, steps: Rec, reasons: string[]): void {
  if (state.current !== null) {
    if (!isString(state.current)) reasons.push('state.current: expected a step id or null')
    else {
      const rec = steps[state.current]
      const stepDef = def.steps[state.current]
      if (stepDef === undefined) reasons.push(`state.current: unknown step '${state.current}'`)
      else if (stepDef.kind !== 'view')
        reasons.push(`state.current: '${state.current}' is not a view`)
      else if (!isRecord(rec) || rec.status !== 'active') {
        reasons.push(`state.current: '${state.current}' is not active`)
      }
    }
  }
  if (!Array.isArray(state.history)) {
    reasons.push('state.history: expected an array')
    return
  }
  for (const id of state.history) {
    if (!isString(id) || def.steps[id] === undefined) {
      reasons.push(`state.history: unknown step ${describe(id)}`)
    } else if (def.steps[id]?.kind !== 'view') {
      reasons.push(`state.history: '${id}' is not a view`)
    }
  }
}

/**
 * Derived-status invariants (§8.8 "status invariants"): the stored status must be consistent
 * with the active set the way `deriveStatus` would compute it.
 */
function checkStatusInvariants(
  def: CompiledFlow,
  state: Rec,
  active: ReadonlySet<string>,
  reasons: string[],
): void {
  if (!isString(state.status) || !WIZARD_STATUSES.has(state.status)) return
  const activeIds = Array.from(active)
  switch (state.status) {
    case 'idle':
      if (activeIds.length > 0) reasons.push('state.status: idle but steps are active')
      if (state.startedAt !== null) reasons.push('state.status: idle but startedAt is set')
      break
    case 'done':
    case 'cancelled':
    case 'compensating':
      if (activeIds.length > 0)
        reasons.push(`state.status: ${state.status} but steps are still active`)
      break
    case 'running':
      if (
        !activeIds.some((id) =>
          ['task', 'decision', 'final', 'flow'].includes(def.steps[id]?.kind ?? ''),
        )
      )
        reasons.push('state.status: running without an active task/decision/flow/final step')
      break
    default:
      break
  }
}

function checkNav(def: CompiledFlow, state: Rec, reasons: string[]): void {
  if (!isRecord(state.nav)) {
    reasons.push('state.nav: expected an object')
    return
  }
  if (!isString(state.nav.phase) || !NAV_PHASES.has(state.nav.phase)) {
    reasons.push(`state.nav.phase: unknown phase ${describe(state.nav.phase)}`)
  }
  if (
    state.nav.cursorHint !== undefined &&
    (!isString(state.nav.cursorHint) || def.steps[state.nav.cursorHint]?.kind !== 'view')
  ) {
    reasons.push(`state.nav.cursorHint: expected a view id, got ${describe(state.nav.cursorHint)}`)
  }
}

/** `SagaState`: `stack: SagaEntry[]`, `compensated`/`failures: SagaEntryRef[]`, optional bookkeeping. */
function checkSaga(def: CompiledFlow, saga: Rec, reasons: string[]): void {
  const isRef = (value: unknown): value is SagaEntryRef =>
    isRecord(value) &&
    isString(value.step) &&
    def.steps[value.step] !== undefined &&
    isNonNegativeInt(value.runId)
  const isEntry = (value: unknown): value is SagaEntry =>
    isRef(value) && isRecord(value) && isNonNegativeInt(value.seq)

  const list = (
    key: 'stack' | 'compensated' | 'failures',
    check: (v: unknown) => boolean,
    shape: string,
  ) => {
    const value = saga[key]
    if (!Array.isArray(value)) {
      reasons.push(`state.saga.${key}: expected an array of ${shape}`)
      return
    }
    value.forEach((item, i) => {
      if (!check(item)) reasons.push(`state.saga.${key}[${i}]: expected ${shape}`)
    })
  }
  list('stack', isEntry, '{ step, runId, seq, output? }')
  list('compensated', isRef, '{ step, runId }')
  list('failures', isRef, '{ step, runId }')

  if (saga.settling !== undefined) {
    if (!isStringArray(saga.settling) || saga.settling.some((id) => def.steps[id] === undefined)) {
      reasons.push('state.saga.settling: expected an array of step ids')
    }
  }
  if (saga.inFlight !== undefined && !isRef(saga.inFlight)) {
    reasons.push('state.saga.inFlight: expected { step, runId }')
  }
  if (saga.outcome !== undefined && saga.outcome !== 'failed' && saga.outcome !== 'cancelled') {
    reasons.push(
      `state.saga.outcome: expected 'failed' | 'cancelled', got ${describe(saga.outcome)}`,
    )
  }
  if (saga.reason !== undefined && !isString(saga.reason)) {
    reasons.push('state.saga.reason: expected a string')
  }
}

function checkInbox(def: CompiledFlow, state: Rec, reasons: string[]): void {
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

function checkTimers(def: CompiledFlow, state: Rec, reasons: string[]): void {
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
function checkIdentity(state: Rec, reasons: string[]): void {
  if (!isNonNegativeInt(state.seq)) reasons.push('state.seq: expected a non-negative integer')
  if (!isNonEmptyString(state.instanceId)) reasons.push('state.instanceId: expected a string')
  if (!isNonNegativeInt(state.epoch)) reasons.push('state.epoch: expected a non-negative integer')
  if (!isRecord(state.flow)) reasons.push('state.flow: expected { name, version }')
  if (state.startedAt !== null && !isFiniteNumber(state.startedAt)) {
    reasons.push('state.startedAt: expected a number or null')
  }
  if (!isFiniteNumber(state.updatedAt)) reasons.push('state.updatedAt: expected a number')
}
