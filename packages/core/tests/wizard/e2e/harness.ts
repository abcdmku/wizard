/**
 * Shared setup for the end-to-end suites: the REAL machine (`src/machine`)
 * driven through `createWizardRuntime` with a deterministic scheduler/clock
 * and sequential ids. Flows come from `tests/helpers/fixtures.ts`.
 */

import type { CompiledFlow } from '../../../src/authoring/compiled'
import { createSequentialIds } from '../../../src/interpreter/env'
import { createTestScheduler, type TestScheduler } from '../../../src/interpreter/test-scheduler'
import type { DomainEvent, DomainEventType } from '../../../src/machine/events'
import { initialState, machine } from '../../../src/machine/index'
import type { WizardState } from '../../../src/machine/state'
import { resumeWizardRuntime } from '../../../src/wizard/resume'
import {
  createWizardRuntime,
  type ResumeWizardRuntimeOptions,
  type WizardRuntime,
  type WizardRuntimeOptions,
} from '../../../src/wizard/runtime'

export interface E2E {
  readonly wizard: WizardRuntime
  readonly sched: TestScheduler
  /** Every event observed (own + children), in arrival order. */
  readonly events: DomainEvent[]
  /** Every committed state, in order. */
  readonly states: WizardState[]
  /** Event types seen so far (own path only unless `all`). */
  types(all?: boolean): DomainEventType[]
  /** Events of one type. */
  of<T extends DomainEventType>(type: T): Extract<DomainEvent, { type: T }>[]
  /** Forget everything observed so far (handy between phases of a scenario). */
  clear(): void
  rec(step: string): WizardState['steps'][string]
}

export function e2e(
  def: CompiledFlow,
  opts: Partial<WizardRuntimeOptions> & { readonly now?: number } = {},
): E2E {
  const sched = createTestScheduler({ now: opts.now ?? 10_000 })
  const { now: _now, ...rest } = opts
  const wizard = createWizardRuntime(def, {
    context: {},
    machine,
    initialState,
    scheduler: sched,
    ids: createSequentialIds(),
    instanceId: 'e2e',
    ...rest,
  })
  return attach(wizard, sched)
}

export function e2eResume(
  def: CompiledFlow,
  snapshot: unknown,
  opts: Partial<ResumeWizardRuntimeOptions> & { readonly now?: number } = {},
): E2E {
  const sched = createTestScheduler({ now: opts.now ?? 10_000 })
  const { now: _now, ...rest } = opts
  const wizard = resumeWizardRuntime(def, snapshot, {
    machine,
    initialState,
    scheduler: sched,
    ids: createSequentialIds(),
    ...rest,
  })
  return attach(wizard, sched)
}

function attach(wizard: WizardRuntime, sched: TestScheduler): E2E {
  // Events committed before we could observe (the `resume` batch of a resumed runtime) are
  // recovered from the log ring so assertions can see them.
  const events: DomainEvent[] = [...wizard.log()]
  const states: WizardState[] = []
  wizard.observe((e) => events.push(e))
  wizard.subscribe((s) => states.push(s))
  return {
    wizard,
    sched,
    events,
    states,
    types: (all = false) =>
      events.filter((e) => all || e.path.length === wizard.path.length).map((e) => e.type),
    of: (type) => events.filter((e): e is never => e.type === type),
    clear: () => {
      events.length = 0
      states.length = 0
    },
    rec: (step) => {
      const r = wizard.getState().steps[step]
      if (r === undefined) throw new Error(`unknown step '${step}'`)
      return r
    },
  }
}

/** Serialize a snapshot the way a real store would. */
export const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

/** Let pending microtasks (async hooks / boundaries) settle. */
export const tick = async (n = 3): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve()
}
