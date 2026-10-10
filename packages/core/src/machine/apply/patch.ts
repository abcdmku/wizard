/**
 * State patch primitives shared by the reducers: immutable updates of one step record, the nav /
 * saga slices, timers, the inbox, and the stored `StepError` shape.
 * @internal
 */

import type { NavState, SagaState, StepError, StepRecord, TimerEntry, WizardState } from '../state'
import { omit } from '../util'

export type RecPatch = Partial<StepRecord>
export type RecKey = keyof StepRecord

export function withStep(
  state: WizardState,
  id: string,
  fn: (rec: StepRecord) => StepRecord,
): WizardState {
  const rec = state.steps[id]
  if (rec === undefined) return state
  return { ...state, steps: { ...state.steps, [id]: fn(rec) } }
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
