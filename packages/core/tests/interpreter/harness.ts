/** Shared setup for the interpreter suites: one interpreter over a test scheduler and sequential ids. */
import type { CompiledWizard } from '../../src/authoring/compiled'
import { createSequentialIds } from '../../src/interpreter/env'
import { createInterpreter, type InterpreterOptions } from '../../src/interpreter/interpreter'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import type { Message } from '../../src/machine/commands'
import type { Effect } from '../../src/machine/effects'
import type { DomainEvent } from '../../src/machine/events'
import { initialState } from '../../src/machine/index'
import type { WizardState } from '../../src/machine/state'
import type { MachineEnv } from '../../src/machine/types'
import { flow, runStep } from '../helpers/fixtures'

export function setup(
  def: CompiledWizard,
  extra: Partial<InterpreterOptions> = {},
  context: unknown = { n: 0 },
) {
  const sched = createTestScheduler({ now: 1_000 })
  const ids = createSequentialIds()
  const env = { clock: sched, scheduler: sched, ids }
  const menv: MachineEnv = { def, path: [], now: () => sched.now(), id: (p) => ids.id(p) }
  const events: DomainEvent[] = []
  const commits: WizardState[] = []
  const effects: Effect[] = []
  const processed: Array<{ msg: Message; batch: readonly DomainEvent[] }> = []
  const interp = createInterpreter({
    def,
    path: [],
    env,
    initialState: initialState(menv, { instanceId: 'w1', context, now: sched.now() }),
    onEvent: (e) => events.push(e),
    onCommit: (s) => commits.push(s),
    onEffect: (fx) => effects.push(fx),
    onProcessed: (msg, batch) => processed.push({ msg, batch }),
    ...extra,
  })
  /** Hook results the interpreter handed to the machine, in order. */
  const results = () =>
    processed.map((p) => p.msg).filter((m) => m.type === 'res.ok' || m.type === 'res.err')
  return { interp, sched, ids, events, commits, effects, processed, results }
}

/** A step `t` running `run`, followed by a no-op step `end`. */
export const taskThenFinal = (
  run: (args: any) => unknown,
  extra: Partial<CompiledWizard['steps'][string]> = {},
): CompiledWizard =>
  flow({
    start: 't',
    steps: { t: { ...runStep({ run, next: 'end' }), ...extra }, end: runStep() },
  })

export const types = (events: readonly DomainEvent[]): string[] => events.map((e) => e.type)
