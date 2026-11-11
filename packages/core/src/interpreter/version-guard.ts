/** Check a command's optimistic version after prior queued work commits. @internal */
import { isCommand, type Message } from '../machine/commands'
import type { DomainEventBody } from '../machine/events'
import type { WizardState } from '../machine/state'
import type { Decision, Machine, MachineEnv } from '../machine/types'

export interface ExpectedVersion {
  readonly epoch: number
  readonly seq: number
}

export function rejectStaleVersion(
  machine: Machine,
  env: MachineEnv,
  state: WizardState,
  message: Message,
  expected: ExpectedVersion | undefined,
): Decision | undefined {
  if (
    expected === undefined ||
    !isCommand(message) ||
    (expected.epoch === state.epoch && expected.seq === state.seq)
  )
    return undefined
  const at = env.now()
  const event: DomainEventBody = {
    type: 'command.rejected',
    command: message,
    code: 'STALE',
    reason: 'stale-version',
  }
  return {
    events: [event],
    state: machine.apply(env, state, { ...event, at, path: env.path, seq: state.seq + 1 }),
    at,
  }
}
