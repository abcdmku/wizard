/**
 * `initialState` — the state of a wizard instance before `start`.
 *
 * Every step of the compiled flow gets an idle record so `steps[id]` is always
 * defined for known ids (the machine never has to guard against missing records
 * for ids that came from `def`).
 *
 * @internal
 */

import type { StepRecord, WizardState } from './state'
import type { InitialState } from './types'

export const initialState: InitialState = (env, opts) => {
  // Null prototype: a step id like `__proto__` is stored as an own property.
  const steps: Record<string, StepRecord> = Object.create(null)
  for (const id of env.def.order) {
    const def = env.def.steps[id]
    if (def === undefined) continue
    steps[id] = {
      id,
      kind: def.kind,
      status: 'idle',
      attempt: 0,
      runId: 0,
      guards: {},
      visitedCount: 0,
      pendingActivation: false,
    }
  }
  const state: WizardState = {
    status: 'idle',
    current: null,
    active: [],
    context: opts.context,
    steps,
    history: [],
    nav: { phase: 'idle' },
    saga: { stack: [], compensated: [], failures: [] },
    inbox: [],
    timers: {},
    seq: 0,
    instanceId: opts.instanceId,
    epoch: opts.epoch ?? 0,
    flow: { name: env.def.name, version: env.def.version },
    startedAt: null,
    updatedAt: opts.now,
  }
  return state
}
