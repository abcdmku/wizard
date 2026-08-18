/**
 * `decide` — messages (commands, effect results, timers, internal) → events.
 *
 * Batch pattern: a batch is computed against the PRE-batch state, but later
 * events depend on earlier ones (arrive → schedule → enter → run …), so every
 * helper folds its own events as it goes through `Batch.emit` (see `batch.ts`:
 * `apply` with a temporary envelope). The interpreter assigns the real
 * envelopes; the two folds are identical because `apply` only reads `seq`/`at`
 * from the envelope.
 *
 * Global rules (§0): unknown messages → `[]`; unknown steps → `command.rejected`
 * / `result.ignored`; token checks come first on every `res.*`; terminal /
 * compensating / not-started gates come first on every command.
 *
 * @internal
 */

import type { Batch } from '../batch'
import { createBatch, emit } from '../batch'
import type { Command, EffectResult, InternalMessage, Message } from '../commands'
import { isCommand } from '../commands'
import type { DomainEventBody } from '../events'
import { navBack, navGo, navNext, rejectNav } from '../nav'
import { schedule } from '../scheduler'
import { isTerminal } from '../selectors'
import type { WizardState } from '../state'
import type { MachineEnv } from '../types'
import { routeEvent } from '../wait'
import { onChildResult } from './child'
import {
  cmdCancel,
  cmdChild,
  cmdCompensate,
  cmdInput,
  cmdInvalidate,
  cmdReset,
  cmdRetry,
  cmdRun,
  cmdSkip,
  cmdStart,
  gate,
  reject,
} from './commands'
import { onResult } from './results'
import { onResume, onTimerFired } from './timers-resume'

export function decide(
  env: MachineEnv,
  state: WizardState,
  msg: Message,
): readonly DomainEventBody[] {
  const b = createBatch(env, state)
  if (isCommand(msg)) decideCommand(b, msg)
  else decideInternal(b, msg)
  return b.events
}

function decideCommand(b: Batch, cmd: Command): void {
  const code = gate(b, cmd)
  if (code !== undefined) {
    if (cmd.type === 'next' || cmd.type === 'go' || cmd.type === 'back') {
      rejectNav(
        b,
        code === 'FLOW_NOT_STARTED'
          ? 'flow-not-started'
          : code === 'FLOW_COMPENSATING'
            ? 'flow-compensating'
            : 'flow-terminal',
      )
    } else if (cmd.type === 'cancel' && b.state.status === 'compensating') {
      // no-op by design
    } else {
      reject(b, cmd, code, code.toLowerCase().replace(/_/g, '-'))
    }
    return
  }
  switch (cmd.type) {
    case 'start':
      cmdStart(b)
      break
    case 'next':
      navNext(b)
      break
    case 'back':
      navBack(b)
      break
    case 'go':
      navGo(b, cmd.step)
      break
    case 'setInput':
    case 'resetInput':
      cmdInput(b, cmd)
      break
    case 'send':
      routeEvent(b, cmd.event, cmd.payload, cmd.correlationId)
      break
    case 'sendRejected':
      emit(b, { type: 'event.rejected', event: cmd.event, issues: cmd.issues })
      break
    case 'run':
      cmdRun(b, cmd)
      break
    case 'runReady':
      schedule(b, { force: true })
      break
    case 'retry':
      cmdRetry(b, cmd)
      break
    case 'cancel':
      cmdCancel(b, cmd.reason)
      break
    case 'compensate':
      cmdCompensate(b, cmd)
      break
    case 'reset':
      cmdReset(b)
      break
    case 'skip':
      cmdSkip(b, cmd)
      break
    case 'invalidate':
      cmdInvalidate(b, cmd)
      break
    case 'child':
      cmdChild(b, cmd)
      break
    default:
      break
  }
}

function decideInternal(b: Batch, msg: EffectResult | InternalMessage): void {
  switch (msg.type) {
    case 'res.ok':
    case 'res.err':
      onResult(b, msg)
      return
    case 'res.child':
      onChildResult(b, msg)
      return
    case 'timer.fired':
      onTimerFired(b, msg.timerId)
      return
    case 'context.patch':
      if (isTerminal(b.state)) return
      emit(b, {
        type: 'context.changed',
        patch: msg.patch,
        ...(msg.by !== undefined ? { by: msg.by } : {}),
      })
      return
    case 'resume':
      onResume(b, msg.fromSeq)
      return
    default:
      return
  }
}
