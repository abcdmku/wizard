/**
 * State patch primitives shared by the reducers: immutable updates of one step record, the nav /
 * saga slices, timers, the inbox, and the stored `StepError` shape.
 * @internal
 */

import type { NavState, SagaState, StepError, StepRecord, TimerEntry, WizardState } from '../state'
import { carryIndex, stepIndex } from '../step-index'
import { omit } from '../util'
import { writeActive, writeStep } from './draft'

export type RecPatch = Partial<StepRecord>
export type RecKey = keyof StepRecord

/** Keep `state.active` in activation order: a newcomer is appended, a leaver removed. */
function activeAfter(
  active: readonly string[],
  before: StepRecord,
  after: StepRecord,
): readonly string[] {
  const was = before.status === 'active'
  const is = after.status === 'active'
  return was === is ? active : writeActive(active, after.id, is)
}

/**
 * The ONE writer of step records: keeps `state.active` and the derived step index in sync.
 * Inside a `decide` batch the write is in place (see `draft.ts`), so it is O(1) amortized.
 */
export function withStep(
  state: WizardState,
  id: string,
  fn: (rec: StepRecord) => StepRecord,
): WizardState {
  const rec = state.steps[id]
  if (rec === undefined) return state
  const next = fn(rec)
  const index = stepIndex(state.steps)
  const steps = writeStep(state.steps, id, rec, next)
  carryIndex(index, steps, rec, next)
  return { ...state, steps, active: activeAfter(state.active, rec, next) }
}

export function patchStep(
  state: WizardState,
  id: string,
  patch: RecPatch,
  clear: readonly RecKey[] = [],
): WizardState {
  return withStep(state, id, (rec) => ({ ...omit(rec, clear), ...patch }) as StepRecord)
}

export function withNav(state: WizardState, nav: NavState): WizardState {
  return { ...state, nav }
}

export function withSaga(state: WizardState, saga: SagaState): WizardState {
  return { ...state, saga }
}

export function withTimer(state: WizardState, timerId: string, entry: TimerEntry): WizardState {
  return { ...state, timers: { ...state.timers, [timerId]: entry } }
}

export function withoutTimer(state: WizardState, timerId: string): WizardState {
  if (!(timerId in state.timers)) return state
  return { ...state, timers: omit(state.timers, [timerId]) }
}

export function withoutInbox(state: WizardState, inboxId: string): WizardState {
  if (!state.inbox.some((e) => e.id === inboxId)) return state
  return { ...state, inbox: state.inbox.filter((e) => e.id !== inboxId) }
}

export function toStepError(
  error: { readonly name: string; readonly message: string; readonly code?: string },
  kind: StepError['kind'],
  at: number,
  attempt?: number,
  data?: unknown,
): StepError {
  return {
    name: error.name,
    message: error.message,
    kind,
    at,
    ...(error.code !== undefined ? { code: error.code } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(data !== undefined ? { data } : {}),
  }
}
