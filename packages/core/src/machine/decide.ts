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

import type { RetryPolicy } from '../authoring/compiled'
import type { Batch } from './batch'
import { createBatch, emit, rec, stepDef } from './batch'
import type { Command, EffectResult, InternalMessage, Message } from './commands'
import { isCommand } from './commands'
import type { DomainEventBody } from './events'
import { completeStep, navBack, navGo, navNext, onNavIdle, onNavResult, rejectNav } from './nav'
import {
  onCompensated,
  onCompensationFailed,
  orphanSettling,
  pendingEntries,
  startCompensation,
  unwindNext,
} from './saga'
import {
  cancelAllActive,
  completeFinal,
  enterStep,
  failStep,
  idempotencyKey,
  retryTimerId,
  schedule,
  startKind,
} from './scheduler'
import { isRecoverableFailure, isTerminal, ready, runInFlight, sameEntry } from './selectors'
import type { WizardState, WizardStatus } from './state'
import type { MachineEnv } from './types'
import { normalizeTargets } from './util'
import {
  drainInbox,
  expireEntry,
  expireInbox,
  onHandlerResult,
  onWaitTimeout,
  routeEvent,
} from './wait'

type ResultMsg = Extract<EffectResult, { type: 'res.ok' | 'res.err' }>
type RejectCode =
  | 'UNKNOWN_STEP'
  | 'NOT_A_VIEW'
  | 'NOT_A_TASK'
  | 'NOT_A_FLOW_STEP'
  | 'NOT_ACTIVE'
  | 'NAV_BUSY'
  | 'FLOW_TERMINAL'
  | 'FLOW_NOT_STARTED'
  | 'FLOW_COMPENSATING'
  | 'INVALID_COMMAND'

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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function reject(b: Batch, command: Command, code: RejectCode, reason: string): void {
  emit(b, { type: 'command.rejected', command, reason, code })
}

const TERMINAL_STATUSES: ReadonlySet<WizardStatus> = new Set(['done', 'failed', 'cancelled'])

/**
 * Status gate (§0). Returns the rejection code, or undefined when the command
 * may proceed. `retry`/`cancel`/`compensate` stay allowed on a halt-failed flow
 * (§5.2); `compensate` re-runs failures after a compensated flow.
 */
function gate(b: Batch, cmd: Command): RejectCode | undefined {
  const s = b.state
  const t = cmd.type
  if (t === 'reset') return undefined
  if (s.status === 'idle') {
    return t === 'start' || t === 'setInput' || t === 'resetInput' ? undefined : 'FLOW_NOT_STARTED'
  }
  if (t === 'start') return isTerminal(s) ? 'FLOW_TERMINAL' : 'INVALID_COMMAND'
  if (s.status === 'compensating') {
    if (t === 'cancel' || t === 'child') return undefined
    if (t === 'compensate') return s.saga.failures.length > 0 ? undefined : 'FLOW_COMPENSATING'
    return 'FLOW_COMPENSATING'
  }
  if (isRecoverableFailure(s)) {
    return t === 'retry' || t === 'cancel' || t === 'compensate' || t === 'child'
      ? undefined
      : 'FLOW_TERMINAL'
  }
  if (TERMINAL_STATUSES.has(s.status)) {
    if (t === 'compensate' && s.saga.failures.length > 0) return undefined
    if (t === 'child') return undefined
    return 'FLOW_TERMINAL'
  }
  return undefined
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
    case 'child':
      cmdChild(b, cmd)
      break
    default:
      break
  }
}

function cmdStart(b: Batch): void {
  const start = b.env.def.start
  emit(b, { type: 'flow.started', start: start[0] ?? '' })
  for (const id of start) emit(b, { type: 'step.arrived', step: id, from: null })
  schedule(b, { cursorCause: 'start' })
}

function cmdInput(b: Batch, cmd: Extract<Command, { type: 'setInput' | 'resetInput' }>): void {
  const def = stepDef(b, cmd.step)
  if (def === undefined) {
    reject(b, cmd, 'UNKNOWN_STEP', 'unknown-step')
    return
  }
  if (def.kind !== 'view') {
    reject(b, cmd, 'NOT_A_VIEW', 'not-a-view')
    return
  }
  if (b.state.nav.phase !== 'idle' && b.state.nav.from === cmd.step) {
    reject(b, cmd, 'NAV_BUSY', 'nav-busy')
    return
  }
  if (cmd.type === 'setInput') {
    emit(b, { type: 'input.changed', step: cmd.step, patch: cmd.patch })
  } else {
    emit(b, { type: 'input.changed', step: cmd.step, patch: def.initial, reset: true })
  }
}

function cmdRun(b: Batch, cmd: Extract<Command, { type: 'run' }>): void {
  const def = stepDef(b, cmd.step)
  if (def === undefined) {
    reject(b, cmd, 'UNKNOWN_STEP', 'unknown-step')
    return
  }
  if (def.kind !== 'task') {
    reject(b, cmd, 'NOT_A_TASK', 'not-a-task')
    return
  }
  if (!ready(b.env.def, b.state, cmd.step)) {
    reject(b, cmd, 'NOT_ACTIVE', 'not-ready')
    return
  }
  enterStep(b, cmd.step, null)
}

function cmdRetry(b: Batch, cmd: Extract<Command, { type: 'retry' }>): void {
  const def = stepDef(b, cmd.step)
  const r = rec(b, cmd.step)
  if (def === undefined || r === undefined) {
    reject(b, cmd, 'UNKNOWN_STEP', 'unknown-step')
    return
  }
  if (def.kind !== 'task') {
    reject(b, cmd, 'NOT_A_TASK', 'not-a-task')
    return
  }
  if (r.status !== 'failed') {
    reject(b, cmd, 'INVALID_COMMAND', 'not-failed')
    return
  }
  emit(b, {
    type: 'step.runStarted',
    step: cmd.step,
    attempt: 1,
    runId: r.runId,
    idempotencyKey: idempotencyKey(b, cmd.step, r.runId),
  })
}

function cmdCancel(b: Batch, reason: string | undefined): void {
  const s = b.state
  if (s.status === 'compensating') return // already unwinding: no-op by design
  const pending = pendingEntries(b).length > 0
  if (b.env.def.policies.onFailure === 'compensate' && pending) {
    startCompensation(b, reason ?? 'cancelled', 'cancelled')
    return
  }
  cancelAllActive(b, reason ?? 'cancelled')
  emit(b, { type: 'flow.cancelled', ...(reason !== undefined ? { reason } : {}) })
}

function cmdCompensate(b: Batch, cmd: Extract<Command, { type: 'compensate' }>): void {
  const s = b.state
  const afterCompensation =
    s.status === 'compensating' || (TERMINAL_STATUSES.has(s.status) && !isRecoverableFailure(s))
  if (afterCompensation) {
    const failures = s.saga.failures.map((f) => f.step)
    if (cmd.from !== undefined && !failures.includes(cmd.from)) {
      reject(b, cmd, 'INVALID_COMMAND', 'not-a-failure')
      return
    }
    startCompensation(
      b,
      cmd.reason ?? 'retry-compensation',
      s.saga.outcome ?? 'failed',
      cmd.from !== undefined ? [cmd.from] : failures,
    )
    return
  }
  const pending = pendingEntries(b).length > 0
  if (pending) {
    startCompensation(b, cmd.reason ?? 'compensate', 'cancelled')
    return
  }
  cancelAllActive(b, cmd.reason ?? 'compensate')
  emit(b, { type: 'flow.cancelled', ...(cmd.reason !== undefined ? { reason: cmd.reason } : {}) })
}

function cmdReset(b: Batch): void {
  for (const timerId of Object.keys(b.state.timers)) emit(b, { type: 'timer.cleared', timerId })
  emit(b, { type: 'flow.reset' })
}

function cmdChild(b: Batch, cmd: Extract<Command, { type: 'child' }>): void {
  const step = cmd.path[0]
  if (step === undefined) {
    reject(b, cmd, 'INVALID_COMMAND', 'empty-path')
    return
  }
  const def = stepDef(b, step)
  const r = rec(b, step)
  if (def === undefined || r === undefined) {
    reject(b, cmd, 'UNKNOWN_STEP', 'unknown-step')
    return
  }
  if (def.kind !== 'flow') {
    reject(b, cmd, 'NOT_A_FLOW_STEP', 'not-a-flow-step')
    return
  }
  if (r.status !== 'active' && r.status !== 'compensating') {
    reject(b, cmd, 'NOT_ACTIVE', 'child-not-running')
    return
  }
  const command: Command =
    cmd.path.length > 1
      ? { type: 'child', path: cmd.path.slice(1), command: cmd.command }
      : cmd.command
  emit(b, { type: 'child.command', step, command })
}

// ---------------------------------------------------------------------------
// Internal messages
// ---------------------------------------------------------------------------

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

function ignore(b: Batch, effectId: string, reason: 'stale' | 'cancelled' | 'unknown-step'): void {
  emit(b, { type: 'result.ignored', effectId, reason })
}

/** Token checks first (§0), then route to the transaction or the step-level handler. */
function onResult(b: Batch, msg: ResultMsg): void {
  const { token } = msg
  const r = rec(b, token.step)
  if (r === undefined) {
    ignore(b, msg.effectId, 'unknown-step')
    return
  }
  if (msg.hook === 'compensate') {
    // The token identifies a stack ENTRY (step, runId of that completion), not the record's runId.
    const inFlight = b.state.saga.inFlight
    if (inFlight === undefined || !sameEntry(inFlight, token) || r.status !== 'compensating') {
      ignore(b, msg.effectId, 'stale')
      return
    }
    if (msg.type === 'res.ok') onCompensated(b, inFlight)
    else onCompensationFailed(b, inFlight, msg.error)
    return
  }
  if (token.runId !== r.runId) {
    ignore(b, msg.effectId, 'stale')
    return
  }
  if (token.attempt !== undefined && token.attempt !== r.attempt) {
    ignore(b, msg.effectId, 'stale')
    return
  }
  if (token.txId !== undefined) {
    if (b.state.nav.txId !== token.txId || !onNavResult(b, msg)) ignore(b, msg.effectId, 'stale')
    return
  }
  if (!onStepResult(b, msg))
    ignore(b, msg.effectId, r.status === 'cancelled' ? 'cancelled' : 'stale')
}

function onStepResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined) return false
  const ok = msg.type === 'res.ok'
  const value = ok ? msg.value : undefined
  // A `strict: 'sync'` violation is a programmer error: the step fails as 'sync-violation' (plan §8.1).
  const fail = (kind: 'hook' | 'child') =>
    failStep(
      b,
      step,
      ok ? { name: 'Error', message: '' } : msg.error,
      !ok && msg.syncViolation === true ? 'sync-violation' : kind,
    )
  switch (msg.hook) {
    case 'enter':
      if (r.status !== 'active' || r.entering !== true) return false
      if (ok) {
        emit(b, { type: 'step.enterCompleted', step })
        startKind(b, step)
      } else fail('hook')
      return true
    case 'run':
      return onRunResult(b, msg)
    case 'next':
      if (def.kind !== 'decision' || r.status !== 'active' || r.entering === true) return false
      if (!ok) fail('hook')
      else {
        // A decision's output is the NORMALIZED target list (`'a'` → `['a']`, `null` → `[]`),
        // which is what `OutputOf<F, decision>` promises (ADR-001 amendment).
        const targets = normalizeTargets(value)
        const unknown = targets.find((t) => stepDef(b, t) === undefined)
        if (unknown !== undefined) {
          failStep(
            b,
            step,
            {
              name: 'WizardError',
              message: `unknown next target '${unknown}'`,
              code: 'UNKNOWN_STEP',
            },
            'hook',
          )
        } else completeStep(b, step, targets)
      }
      return true
    case 'on':
      if (def.kind !== 'wait' || r.status !== 'active' || r.entering === true) return false
      if (ok)
        onHandlerResult(b, step, value as Parameters<typeof onHandlerResult>[2], msg.extra ?? {})
      else fail('hook')
      return true
    case 'childContext':
      if (def.kind !== 'flow' || r.status !== 'active' || r.entering === true) return false
      if (ok)
        emit(b, { type: 'child.started', step, childPath: [...b.env.path, step], context: value })
      else fail('hook')
      return true
    case 'childOutput':
      if (def.kind !== 'flow' || r.status !== 'active') return false
      if (ok) completeStep(b, step, value)
      else fail('hook')
      return true
    case 'finalOutput':
      if (def.kind !== 'final' || r.status !== 'active' || r.entering === true) return false
      if (ok) completeFinal(b, step, value)
      else fail('hook')
      return true
    default:
      return false
  }
}

/** `RetryPolicy` backoff (§4.1): fixed ms, or exponential `min(baseMs * factor^(attempt-1), maxBackoffMs)`. */
function backoffMs(policy: RetryPolicy | undefined, attempt: number): number {
  const backoff = policy?.backoff
  if (backoff === undefined) return 0
  if (typeof backoff === 'number') return backoff
  const base = policy?.baseMs ?? 200
  const factor = policy?.factor ?? 2
  return Math.min(base * factor ** (attempt - 1), policy?.maxBackoffMs ?? 30_000)
}

function onRunResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const r = rec(b, step)
  const def = stepDef(b, step)
  if (r === undefined || def === undefined || def.kind !== 'task') return false
  const settling = b.state.saga.settling?.includes(step) === true
  if (r.status === 'cancelled' && settling) {
    // Compensation phase 1: a late result of an aborted run still settles (and a late success is pushed on the stack).
    if (msg.type === 'res.ok') {
      emit(b, { type: 'step.runSucceeded', step, attempt: r.attempt, output: msg.value })
      emit(b, {
        type: 'step.done',
        step,
        ...(msg.value !== undefined ? { output: msg.value } : {}),
      })
    } else {
      emit(b, {
        type: 'step.runFailed',
        step,
        attempt: r.attempt,
        error: msg.error,
        willRetry: false,
        ...(msg.timedOut === true ? { timedOut: true } : {}),
      })
    }
    unwindNext(b)
    return true
  }
  if (!runInFlight(r)) return false
  if (msg.type === 'res.ok') {
    emit(b, { type: 'step.runSucceeded', step, attempt: r.attempt, output: msg.value })
    completeStep(b, step, msg.value)
    return true
  }
  if (msg.syncViolation === true) {
    // `strict: 'sync'` violation: never retried, fails as 'sync-violation' (plan §8.1).
    emit(b, {
      type: 'step.runFailed',
      step,
      attempt: r.attempt,
      error: msg.error,
      willRetry: false,
    })
    failStep(b, step, msg.error, 'sync-violation')
    return true
  }
  const policy = def.retry ?? b.env.def.policies.retry
  const allowed = policy?.attempts ?? 0
  const timedOut = msg.timedOut === true
  if (r.attempt <= allowed) {
    emit(b, {
      type: 'step.runFailed',
      step,
      attempt: r.attempt,
      error: msg.error,
      willRetry: true,
      ...(timedOut ? { timedOut: true } : {}),
    })
    const timerId = retryTimerId(step)
    emit(b, {
      type: 'step.retryScheduled',
      step,
      attempt: r.attempt + 1,
      dueAt: b.env.now() + backoffMs(policy, r.attempt),
      timerId,
    })
    return true
  }
  emit(b, {
    type: 'step.runFailed',
    step,
    attempt: r.attempt,
    error: msg.error,
    willRetry: false,
    ...(timedOut ? { timedOut: true } : {}),
  })
  failStep(b, step, msg.error, timedOut ? 'timeout' : 'run')
  return true
}

const CHILD_TERMINAL: ReadonlySet<WizardStatus> = new Set(['done', 'failed', 'cancelled'])

function onChildResult(b: Batch, msg: Extract<EffectResult, { type: 'res.child' }>): void {
  const r = rec(b, msg.step)
  const def = stepDef(b, msg.step)
  const effectId = `child:${msg.step}`
  if (r === undefined || def === undefined) {
    ignore(b, effectId, 'unknown-step')
    return
  }
  // Freshness: right kind, the parent runId the child was created under, increasing summary seq.
  if (def.kind !== 'flow' || msg.token.step !== msg.step || msg.token.runId !== r.runId) {
    ignore(b, effectId, 'stale')
    return
  }
  if (r.child !== undefined && msg.summary.seq <= r.child.seq) {
    ignore(b, effectId, 'stale')
    return
  }
  if (r.status === 'compensating') {
    // Only an explicit compensation completion (or a failed/cancelled child) ends the entry;
    // a child that reports `done` while the parent unwinds is not a success.
    const inFlight = b.state.saga.inFlight
    const finished =
      msg.phase === 'compensated' ||
      msg.summary.status === 'failed' ||
      msg.summary.status === 'cancelled'
    if (finished && inFlight !== undefined && inFlight.step === msg.step) onCompensated(b, inFlight)
    return
  }
  if (r.status !== 'active') return
  const first = r.child === undefined || !CHILD_TERMINAL.has(r.child.status)
  emit(b, {
    type: 'child.summary',
    step: msg.step,
    summary: msg.summary,
    ...(first && msg.done !== undefined ? { done: msg.done } : {}),
  })
  if (!first) return
  if (msg.done !== undefined) {
    if (stepDef(b, msg.step)?.hooks.childOutput === undefined)
      completeStep(b, msg.step, msg.done.output)
    return
  }
  if (msg.failed !== undefined) failStep(b, msg.step, msg.failed.error, 'child')
}

function onTimerFired(b: Batch, timerId: string): void {
  const entry = b.state.timers[timerId]
  if (entry === undefined) return
  emit(b, { type: 'timer.fired', timerId })
  const owner = entry.step !== undefined ? rec(b, entry.step) : undefined
  switch (entry.purpose) {
    case 'retry': {
      if (owner === undefined || entry.step === undefined) return
      if (owner.status !== 'active' || owner.kind !== 'task') return
      emit(b, {
        type: 'step.runStarted',
        step: entry.step,
        attempt: owner.attempt + 1,
        runId: owner.runId,
        idempotencyKey: idempotencyKey(b, entry.step, owner.runId),
      })
      return
    }
    case 'waitTimeout': {
      if (owner === undefined || entry.step === undefined) return
      if (owner.status !== 'active' || owner.entering === true) return
      onWaitTimeout(b, entry.step)
      return
    }
    case 'inboxTtl': {
      const inbox = b.state.inbox.find((e) => `inbox:${e.id}` === timerId)
      if (inbox !== undefined) expireEntry(b, inbox.id)
      return
    }
    case 'compensationGrace':
      if (b.state.status === 'compensating') orphanSettling(b, 'ORPHANED')
      return
    default:
      return
  }
}

/** Resume matrix (plan §8.8). `plan(flow.resumed)` re-arms timers and re-issues in-flight hook calls. */
function onResume(b: Batch, fromSeq: number): void {
  const s = b.state
  const interrupted = s.active.filter((id) => runInFlight(s.steps[id]))
  emit(b, { type: 'flow.resumed', fromSeq, interrupted })
  if (s.nav.phase !== 'idle') rejectNav(b, 'resumed', { txId: s.nav.txId ?? b.env.id('tx') })
  for (const step of interrupted) {
    failStep(
      b,
      step,
      { name: 'InterruptedError', message: 'run interrupted by a restart', code: 'INTERRUPTED' },
      'interrupted',
    )
  }
  expireInbox(b)
  for (const id of [...b.state.active]) {
    const r = rec(b, id)
    if (r?.kind === 'wait' && r.status === 'active' && r.entering !== true) drainInbox(b, id)
  }
  if (b.state.status === 'compensating') {
    // Aborted runs can never report after a restart: settle them as interrupted, then continue.
    if ((b.state.saga.settling?.length ?? 0) > 0) orphanSettling(b, 'INTERRUPTED')
    else unwindNext(b)
  } else if (!isTerminal(b.state)) {
    onNavIdle(b)
    schedule(b)
  }
}
