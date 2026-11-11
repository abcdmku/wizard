/** Boundary parsing and recursive snapshot preparation for resume. @internal */

import type { BoundaryResult, CompiledWizard, RuntimeBoundary } from '../authoring/compiled'
import { describeError } from '../errors'
import { parseEachChildAddress } from '../interpreter/each-child'
import { noop } from '../interpreter/executor-invoke'
import { getThen, type Then } from '../interpreter/thenable'
import { idleRecord } from '../machine/initial'
import type { StepRecord } from '../machine/state'
import { setOwn } from '../machine/util'
import { reviveEach, reviveOutput } from './resume-outputs'
import type { ResumePlan } from './runtime'
import { validateSnapshot } from './snapshot'

/** How `prepareResume` runs one boundary and records rejection reasons. */
export type BoundaryParser = (
  at: string,
  boundary: RuntimeBoundary,
  value: unknown,
  reasons: string[],
) => { readonly value: unknown } | undefined

/**
 * Call a sync hook and safely classify its result. Thenables get a rejection sink and are
 * reported to the caller as asynchronous; throws become a human-readable reason.
 */
export function callSync(
  fn: () => unknown,
  what: string,
  reasons: string[],
): { readonly value: unknown; readonly async?: false } | { readonly async: true } | undefined {
  let value: unknown
  let then: Then | undefined
  try {
    value = fn()
    then = getThen(value)
  } catch (error) {
    reasons.push(`${what} threw (${describeError(error)})`)
    return undefined
  }
  if (then === undefined) return { value }
  try {
    then.call(value, noop, noop)
  } catch {
    // The sink is best-effort: a `then` that throws has nothing left to reject.
  }
  return { async: true }
}

/** The synchronous parser: a thenable result is a reason (use the async variant). */
export const parseBoundarySync: BoundaryParser = (at, boundary, value, reasons) => {
  const settled = callSync(() => boundary.parse(value), `${at}: boundary`, reasons)
  if (settled === undefined) return undefined
  if (settled.async) {
    reasons.push(`${at}: async boundaries are not supported by resume() (use resumeAsync())`)
    return undefined
  }
  return interpretResult(at, settled.value, reasons)
}

export function interpretResult(
  at: string,
  result: unknown,
  reasons: string[],
): { readonly value: unknown } | undefined {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    const r = result as BoundaryResult
    if (r.ok) return { value: r.value }
    const issues = Array.isArray(r.issues) ? r.issues : []
    const detail = issues.map((i: unknown) => (isIssueLike(i) ? i.message : String(i))).join(', ')
    reasons.push(`${at}: rejected by boundary${detail.length > 0 ? ` (${detail})` : ''}`)
    return undefined
  }
  reasons.push(`${at}: boundary returned an invalid result`)
  return undefined
}

/**
 * Validate one snapshot tree and re-run every persisted value through its boundary. Problems are
 * accumulated as readable reasons so resume remains atomic.
 */
export function prepareResume(
  def: CompiledWizard,
  input: unknown,
  prefix: string,
  reasons: string[],
  parse: BoundaryParser = parseBoundarySync,
): ResumePlan | undefined {
  const validation = validateSnapshot(def, input)
  if (!validation.ok) {
    for (const r of validation.reasons) reasons.push(prefix + r)
    return undefined
  }
  const snapshot = validation.snapshot
  const state = snapshot.state
  const run = (at: string, boundary: RuntimeBoundary, value: unknown) =>
    parse(prefix + at, boundary, value, reasons)

  const context = run('context', def.context, state.context)
  const children: Record<string, ResumePlan> = {}
  for (const [step, child] of Object.entries(snapshot.children)) {
    const owner = Object.hasOwn(def.steps, step) ? step : parseEachChildAddress(step)?.step
    const childDef = owner === undefined ? undefined : def.steps[owner]?.child
    if (childDef === undefined) continue
    const childPlan = prepareResume(childDef, child, `${prefix}children.${step}.`, reasons, parse)
    if (childPlan !== undefined) setOwn(children, step, childPlan)
  }

  const steps: Record<string, StepRecord> = {}
  for (const id of def.order) {
    const stepDef = def.steps[id]
    if (stepDef === undefined) continue
    // A step the definition added after this snapshot was taken starts idle.
    const rec = Object.hasOwn(state.steps, id) ? state.steps[id] : undefined
    if (rec === undefined) {
      setOwn(steps, id, idleRecord(id, stepDef.kind))
      continue
    }
    let next = rec
    if (rec.output !== undefined)
      next = { ...next, output: reviveOutput(stepDef, `steps.${id}.output`, rec.output, run) }
    if (rec.previousOutput !== undefined)
      next = {
        ...next,
        previousOutput: reviveOutput(
          stepDef,
          `steps.${id}.previousOutput`,
          rec.previousOutput,
          run,
        ),
      }
    if (rec.each !== undefined)
      next = { ...next, each: reviveEach(stepDef, `steps.${id}.each`, rec.each, run) }
    // Missing child snapshot for a live child step: forget its summary so resume re-creates it.
    if (
      stepDef.kind === 'child' &&
      rec.status === 'active' &&
      rec.child !== undefined &&
      !Object.hasOwn(children, id) &&
      stepDef.each === undefined
    ) {
      const { child: _dropped, ...rest } = next
      next = rest
    }
    setOwn(steps, id, next)
  }

  const inbox = state.inbox.map((entry, i) => {
    const boundary = Object.hasOwn(def.events, entry.event) ? def.events[entry.event] : undefined
    if (boundary === undefined) return entry
    const parsed = run(`inbox[${i}].payload`, boundary, entry.payload)
    return parsed === undefined ? entry : { ...entry, payload: parsed.value }
  })

  // Compensation entries hold completed outputs, so revive them through the same boundary.
  const stack = state.saga.stack.map((entry, i) => {
    if (entry.output === undefined) return entry
    const stepDef = Object.hasOwn(def.steps, entry.step) ? def.steps[entry.step] : undefined
    if (stepDef === undefined) return entry
    return { ...entry, output: reviveOutput(stepDef, `saga.stack[${i}].output`, entry.output, run) }
  })

  if (context === undefined) return undefined
  return {
    snapshot,
    state: {
      ...state,
      context: context.value,
      steps,
      inbox,
      saga: { ...state.saga, stack },
      epoch: state.epoch + 1,
      ...(state.status === 'done' && def.output === undefined && state.output !== undefined
        ? {
            output: revivedWizardOutput(def, steps),
            terminal: {
              ...state.terminal,
              status: 'done' as const,
              output: revivedWizardOutput(def, steps),
            },
          }
        : {}),
    },
    children,
  }
}

function isIssueLike(value: unknown): value is { readonly message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

function revivedWizardOutput(
  def: CompiledWizard,
  steps: Readonly<Record<string, StepRecord>>,
): unknown {
  let latest: StepRecord | undefined
  for (const id of def.sinks) {
    const record = steps[id]
    if (record?.status !== 'done') continue
    if (latest === undefined || (record.completedSeq ?? 0) >= (latest.completedSeq ?? 0))
      latest = record
  }
  return latest?.output
}
