/**
 * Machine barrel — the pure engine (`decide` / `apply` / `plan`), the initial
 * state builder, selectors and `explain`. Consumed by the interpreter
 * (`createWizardRuntime(def, { machine, initialState, … })`), the Mirror and tests.
 *
 * @internal
 */

import { apply, deriveStatus } from './apply'
import { decide } from './decide'
import { plan } from './plan'
import type { Machine } from './types'

export const machine: Machine = { decide, apply, plan }

export { type Explanation, explain } from './explain'
export { initialState } from './initial'
export { AUTO_ADVANCE_LIMIT } from './nav'
export { inboxTimerId, retryTimerId, waitTimerId } from './scheduler'
export {
  activeTaskCount,
  available,
  awaitingWhen,
  cursorTarget,
  depsSatisfied,
  eligible,
  eligibleSteps,
  isRecoverableFailure,
  isTerminal,
  type Progress,
  phase,
  progress,
  ready,
  readyOrCurrentViews,
  readySteps,
  readyViews,
  runInFlight,
  type StepPhase,
  unmetDeps,
  viewsAwaitingWhen,
} from './selectors'
export type { InitialState, InitialStateOptions, Machine, MachineEnv } from './types'
export { apply, decide, deriveStatus, plan }
