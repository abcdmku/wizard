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
 * Global rules: unknown messages → `[]`; unknown steps → `command.rejected`
 * / `result.ignored`; token checks come first on every `res.*`; terminal /
 * compensating / not-started gates come first on every command.
 *
 * @internal
 */

import type { Batch } from '../batch'
import { createBatch, emit } from '../batch'
import type { Command, EffectResult, InternalMessage, Message } from '../commands'
import { isCommand } from '../commands'
import { isDuplicateEvent } from '../event-ids'
import type { TransitionRejectReason } from '../events'
import { navBack, navGo, navNext, rejectNav } from '../nav'
import { schedule } from '../scheduler'
import type { WizardState } from '../state'
import type { Decision, MachineEnv } from '../types'
import { routeEvent } from '../wait'
import { onChildResult } from './child'
import {
  cmdCancel,
  cmdChild,
  cmdCompensate,
  cmdInvalidate,
  cmdReset,
  cmdRetry,
  cmdRun,
  cmdSkip,
  cmdStart,
  gate,
  type RejectCode,
  reject,
} from './commands'
import { cmdInput, onContextPatch } from './input'
import { onResult } from './results'
import { onSettle } from './settle'
import { fireOverdue, onResume, onTimerFired } from './timers-resume'

export function decide(env: MachineEnv, state: WizardState, msg: Message): Decision {
  const b = createBatch(env, state, isHopBoundary(msg))
  if (isCommand(msg)) decideCommand(b, msg)
  else decideInternal(b, msg)
  return { events: b.events, state: b.state, at: b.at }
}

const NAV_REJECT: Partial<Record<RejectCode, TransitionRejectReason>> = {
  RUN_NOT_STARTED: 'run-not-started',
  RUN_COMPENSATING: 'run-compensating',
  RUN_HALTED: 'run-halted',
}

/**
 * An asynchronously settled hook or child run restarts the auto-advance hop guard (external
 * messages reset it in `apply`).
 */
function isHopBoundary(msg: Message): boolean {
  return (
    (msg.type === 'res.ok' || msg.type === 'res.err' || msg.type === 'res.child') &&
    msg.async === true
  )
}

/**
 * `send`: wait timeouts and retries already due fire first (deadlines are absolute, also
 * across restarts), then the event is routed — unless those timers ended the run.
 */
function cmdSend(b: Batch, cmd: Extract<Command, { type: 'send' }>): void {
  fireOverdue(b)
  const code = gate(b, cmd)
  if (code !== undefined) reject(b, cmd, code, code.toLowerCase().replace(/_/g, '-'))
  else routeEvent(b, cmd)
}

function decideCommand(b: Batch, cmd: Command): void {
  // A remembered delivery is a duplicate in every status: it emits nothing.
  if (
    cmd.type === 'send' &&
    cmd.eventId !== undefined &&
    isDuplicateEvent(b.env, b.state, cmd.eventId)
  )
    return
  const code = gate(b, cmd)
  if (code !== undefined) {
    if (cmd.type === 'next' || cmd.type === 'go' || cmd.type === 'back') {
      rejectNav(b, NAV_REJECT[code] ?? 'run-terminal')
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
      cmdSend(b, cmd)
      break
    case 'sendRejected':
      emit(b, { type: 'event.rejected', event: cmd.event, issues: cmd.issues })
      break
    case 'startStep':
      cmdRun(b, cmd)
      break
    case 'startReady':
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
      onContextPatch(b, msg)
      return
    case 'settle':
      onSettle(b)
      return
    case 'resume':
      onResume(b, msg.fromSeq)
      return
    default:
      return
  }
}
