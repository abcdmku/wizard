/**
 * Snapshot envelope + structural validation (plan §8.8).
 *
 * `toSnapshot(state, children, savedAt)` wraps a wizard state (and its live
 * children's snapshots) in the versioned, JSON-serializable envelope that
 * `Store`s persist. `validateSnapshot(def, unknown)` performs every check
 * that does not need to run user code: envelope, flow identity, step-set
 * equality, status invariants and JSON safety. Boundaries (context, view
 * outputs, inbox payloads) are re-run by `resumeWizardRuntime`.
 *
 * @public
 */

import type { CompiledFlow } from '../authoring/compiled'
import type {
  NavPhase,
  SagaEntry,
  SagaEntryRef,
  StepStatus,
  TimerEntry,
  WizardState,
  WizardStatus,
} from '../machine/state'
import { decodeCommand } from './parse-command'

export interface Snapshot {
  readonly v: 1
  readonly flow: { readonly name: string; readonly version: number }
  readonly instanceId: string
  readonly epoch: number
  readonly seq: number
  readonly savedAt: number
  readonly state: WizardState
  /** Snapshots of nested flows keyed by the parent's `flow` step id. */
  readonly children: Readonly<Record<string, Snapshot>>
}

export type SnapshotValidation =
  | { readonly ok: true; readonly snapshot: Snapshot }
  | { readonly ok: false; readonly reasons: readonly string[] }

export function toSnapshot(
  state: WizardState,
  children: Readonly<Record<string, Snapshot>>,
  savedAt: number,
): Snapshot {
  return {
    v: 1,
    flow: { name: state.flow.name, version: state.flow.version },
    instanceId: state.instanceId,
    epoch: state.epoch,
    seq: state.seq,
    savedAt,
    state,
    children,
  }
}

const WIZARD_STATUSES: ReadonlySet<string> = new Set<WizardStatus>([
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

/**
 * Structural validation of an untrusted snapshot against a compiled flow.
 * Never throws; every problem is a human-readable reason (`path: message`).
 */
export function validateSnapshot(def: CompiledFlow, input: unknown): SnapshotValidation {
  const reasons: string[] = []
  if (isSnapshotOf(def, input, reasons)) return { ok: true, snapshot: input }
  return { ok: false, reasons }
}

// ---------------------------------------------------------------------------
// Checks (type predicate so the caller gets a typed Snapshot without a cast)
// ---------------------------------------------------------------------------

function isSnapshotOf(def: CompiledFlow, input: unknown, reasons: string[]): input is Snapshot {
  if (!isRecord(input)) {
    reasons.push('snapshot: expected an object')
    return false
  }
  if (input.v !== 1) reasons.push(`v: expected 1, got ${describe(input.v)}`)
  if (!isRecord(input.flow)) reasons.push('flow: expected { name, version }')
  else {
    if (input.flow.name !== def.name) {
      reasons.push(`flow.name: expected '${def.name}', got ${describe(input.flow.name)}`)
    }
    if (input.flow.version !== def.version) {
      reasons.push(`flow.version: expected ${def.version}, got ${describe(input.flow.version)}`)
    }
  }
  if (!isNonEmptyString(input.instanceId)) reasons.push('instanceId: expected a non-empty string')
  if (!isNonNegativeInt(input.epoch)) reasons.push('epoch: expected a non-negative integer')
  if (!isNonNegativeInt(input.seq)) reasons.push('seq: expected a non-negative integer')
  if (!isFiniteNumber(input.savedAt)) reasons.push('savedAt: expected a number')
  if (!isRecord(input.children)) reasons.push('children: expected an object')
  if (!isRecord(input.state)) {
    reasons.push('state: expected an object')
    return false
  }

  const state = input.state
  checkState(def, state, reasons)

  // Envelope ↔ state consistency.
  if (isNonNegativeInt(input.seq) && state.seq !== input.seq) {
    reasons.push(
      `state.seq: expected ${String(input.seq)} (envelope seq), got ${describe(state.seq)}`,
    )
  }
  if (isNonEmptyString(input.instanceId) && state.instanceId !== input.instanceId) {
    reasons.push('state.instanceId: does not match the envelope')
  }
  if (isNonNegativeInt(input.epoch) && state.epoch !== input.epoch) {
    reasons.push('state.epoch: does not match the envelope')
  }
  if (
    isRecord(state.flow) &&
    (state.flow.name !== def.name || state.flow.version !== def.version)
  ) {
    reasons.push(`state.flow: expected ${def.name}@${def.version}`)
  }

  // JSON safety of the persisted state (children are checked recursively below).
  checkJsonSafe(state, 'state', reasons, new WeakSet())

  if (isRecord(input.children)) {
    for (const [step, child] of Object.entries(input.children)) {
      const stepDef = def.steps[step]
      if (stepDef === undefined || stepDef.kind !== 'flow' || stepDef.child === undefined) {
        reasons.push(`children.${step}: '${step}' is not a flow step`)
        continue
      }
      const nested: string[] = []
      if (!isSnapshotOf(stepDef.child, child, nested)) {
        for (const r of nested) reasons.push(`children.${step}.${r}`)
      }
    }
  }

  return reasons.length === 0
}

function checkState(def: CompiledFlow, state: Record<string, unknown>, reasons: string[]): void {
  if (!isString(state.status) || !WIZARD_STATUSES.has(state.status)) {
    reasons.push(`state.status: unknown status ${describe(state.status)}`)
  }
  if (!isRecord(state.steps)) {
    reasons.push('state.steps: expected an object')
    return
  }
  const steps = state.steps

  // Step-set equality with the definition.
  const expected = new Set(def.order)
  for (const id of def.order)
    if (!Object.hasOwn(steps, id)) reasons.push(`state.steps: missing step '${id}'`)
  for (const id of Object.keys(steps))
    if (!expected.has(id)) reasons.push(`state.steps: unknown step '${id}'`)

  const activeSet = new Set<string>()
  if (!Array.isArray(state.active)) reasons.push('state.active: expected an array')
  else {
    for (const id of state.active) {
      if (!isString(id) || !Object.hasOwn(steps, id))
        reasons.push(`state.active: unknown step ${describe(id)}`)
      else if (activeSet.has(id)) reasons.push(`state.active: duplicate entry '${id}'`)
      else activeSet.add(id)
    }
  }

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
      const listed = activeSet.has(id)
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

  if (!Array.isArray(state.history)) reasons.push('state.history: expected an array')
  else {
    for (const id of state.history) {
      if (!isString(id) || def.steps[id] === undefined) {
        reasons.push(`state.history: unknown step ${describe(id)}`)
      } else if (def.steps[id]?.kind !== 'view') {
        reasons.push(`state.history: '${id}' is not a view`)
      }
    }
  }

  // Derived-status invariants (§8.8 "status invariants"): the stored status must be
  // consistent with the active set the way `deriveStatus` would compute it.
  if (isString(state.status) && WIZARD_STATUSES.has(state.status)) {
    const kindOf = (id: string): string | undefined => def.steps[id]?.kind
    const activeIds = Array.from(activeSet)
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
          !activeIds.some((id) => ['task', 'decision', 'final', 'flow'].includes(kindOf(id) ?? ''))
        )
          reasons.push('state.status: running without an active task/decision/flow/final step')
        break
      default:
        break
    }
  }

  if (!isRecord(state.nav)) reasons.push('state.nav: expected an object')
  else {
    if (!isString(state.nav.phase) || !NAV_PHASES.has(state.nav.phase)) {
      reasons.push(`state.nav.phase: unknown phase ${describe(state.nav.phase)}`)
    }
    if (
      state.nav.cursorHint !== undefined &&
      (!isString(state.nav.cursorHint) || def.steps[state.nav.cursorHint]?.kind !== 'view')
    ) {
      reasons.push(
        `state.nav.cursorHint: expected a view id, got ${describe(state.nav.cursorHint)}`,
      )
    }
  }
  if (state.correlationId !== undefined && !isString(state.correlationId)) {
    reasons.push('state.correlationId: expected a string')
  }

  if (!isRecord(state.saga)) reasons.push('state.saga: expected an object')
  else checkSaga(def, state.saga, reasons)

  if (!Array.isArray(state.inbox)) reasons.push('state.inbox: expected an array')
  else {
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

  if (!isRecord(state.timers)) reasons.push('state.timers: expected an object')
  else {
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

  if (!isNonNegativeInt(state.seq)) reasons.push('state.seq: expected a non-negative integer')
  if (!isNonEmptyString(state.instanceId)) reasons.push('state.instanceId: expected a string')
  if (!isNonNegativeInt(state.epoch)) reasons.push('state.epoch: expected a non-negative integer')
  if (!isRecord(state.flow)) reasons.push('state.flow: expected { name, version }')
  if (state.startedAt !== null && !isFiniteNumber(state.startedAt)) {
    reasons.push('state.startedAt: expected a number or null')
  }
  if (!isFiniteNumber(state.updatedAt)) reasons.push('state.updatedAt: expected a number')
}

/** `SagaState`: `stack: SagaEntry[]`, `compensated`/`failures: SagaEntryRef[]`, optional bookkeeping. */
function checkSaga(def: CompiledFlow, saga: Record<string, unknown>, reasons: string[]): void {
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

const TIMER_PURPOSES: ReadonlySet<string> = new Set<NonNullable<TimerEntry['purpose']>>([
  'retry',
  'waitTimeout',
  'inboxTtl',
  'compensationGrace',
])

/** `TimerEntry.fire` is either the internal `timer.fired` message for this id or a wire-valid command. */
function isValidTimerFire(fire: unknown, timerId: string): boolean {
  if (!isRecord(fire)) return false
  if (fire.type === 'timer.fired') {
    return fire.timerId === timerId && Object.keys(fire).length === 2
  }
  return decodeCommand(fire).ok
}

/**
 * Reject anything `JSON.stringify` would drop or distort — including `undefined`
 * values: the state contract says optional fields are *absent*, never undefined,
 * so an `undefined` here means the snapshot did not come from a serializer.
 */
function checkJsonSafe(
  value: unknown,
  path: string,
  reasons: string[],
  seen: WeakSet<object>,
): void {
  switch (typeof value) {
    case 'undefined':
      reasons.push(`${path}: undefined is not serializable (omit the property instead)`)
      return
    case 'function':
      reasons.push(`${path}: functions are not serializable`)
      return
    case 'symbol':
      reasons.push(`${path}: symbols are not serializable`)
      return
    case 'bigint':
      reasons.push(`${path}: bigint is not serializable`)
      return
    case 'number':
      if (!Number.isFinite(value)) reasons.push(`${path}: non-finite numbers are not serializable`)
      return
    case 'object':
      break
    default:
      return
  }
  if (value === null) return
  if (seen.has(value)) {
    reasons.push(`${path}: circular reference`)
    return
  }
  seen.add(value)
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1)
      checkJsonSafe(value[i], `${path}[${i}]`, reasons, seen)
    return
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    reasons.push(`${path}: non-plain object (${describeProto(proto)}) is not serializable`)
    return
  }
  for (const [key, item] of Object.entries(value))
    checkJsonSafe(item, `${path}.${key}`, reasons, seen)
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

function describe(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'object') return Array.isArray(value) ? 'an array' : 'an object'
  return String(value)
}

function describeProto(proto: object): string {
  const ctor = 'constructor' in proto ? proto.constructor : undefined
  return typeof ctor === 'function' && ctor.name.length > 0 ? ctor.name : 'unknown prototype'
}
