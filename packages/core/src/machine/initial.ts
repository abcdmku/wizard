/**
 * `initialState` — the state of a run instance before `start`.
 *
 * Every step of the compiled wizard gets an idle record so `steps[id]` is always
 * defined for known ids (the machine never has to guard against missing records
 * for ids that came from `def`).
 *
 * @internal
 */

import type { StepKind } from '../authoring/compiled'
import type { StepRecord, WizardState } from './state'
import type { InitialState } from './types'
import { setOwn } from './util'

/** The record of a step that never ran (also fills steps a resumed snapshot predates). */
export function idleRecord(id: string, kind: StepKind): StepRecord {
  return {
    id,
    kind,
    status: 'idle',
    attempt: 0,
    runId: 0,
    guards: {},
    visitedCount: 0,
    pendingActivation: false,
  }
}

export const initialState: InitialState = (env, opts) => {
  // A plain object that round-trips through JSON; `setOwn` stores a `__proto__` id as an own key.
  const steps: Record<string, StepRecord> = {}
  for (const id of env.def.order) {
    const def = env.def.steps[id]
    if (def !== undefined) setOwn(steps, id, idleRecord(id, def.kind))
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
    ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
    epoch: opts.epoch ?? 0,
    wizard: { name: env.def.name, version: env.def.version },
    startedAt: null,
    updatedAt: opts.now,
  }
  return state
}
