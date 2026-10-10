/**
 * Commands → events: the status gate (§0) and one function per command (`start`, `setInput` /
 * `resetInput`, `run`, `retry`, `skip`, `invalidate`, `cancel`, `compensate`, `reset`, `child`).
 * Navigation commands live in `nav.ts`, `send` in `wait.ts`.
 * @internal
 */

import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import type { Command } from '../commands'
import { pendingEntries, startCompensation } from '../saga'
import {
  cancelAllActive,
  cancelStep,
  currentIdempotencyKey,
  enterStep,
  schedule,
  skipStep,
} from '../scheduler'
import { awaitingWhen, eligible, isRecoverableFailure, isTerminal, ready } from '../selectors'
import type { WizardStatus } from '../state'

export type RejectCode =
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

export function reject(b: Batch, command: Command, code: RejectCode, reason: string): void {
  emit(b, { type: 'command.rejected', command, reason, code })
}

export const TERMINAL_STATUSES: ReadonlySet<WizardStatus> = new Set(['done', 'failed', 'cancelled'])

/**
 * Status gate (§0). Returns the rejection code, or undefined when the command
 * may proceed. `retry`/`cancel`/`compensate` stay allowed on a halt-failed flow
 * (§5.2); `compensate` re-runs failures after a compensated flow.
 */
export function gate(b: Batch, cmd: Command): RejectCode | undefined {
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
    // v0.2: `invalidate` (§10.3) is a second recovery path — invalidating the failed step un-halts the flow.
    return t === 'retry' ||
      t === 'cancel' ||
      t === 'compensate' ||
      t === 'child' ||
      t === 'invalidate'
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

export function cmdStart(b: Batch): void {
  const start = b.env.def.start
  emit(b, { type: 'flow.started', start: start[0] ?? '' })
  for (const id of start) emit(b, { type: 'step.arrived', step: id, from: null })
  schedule(b, { cursorCause: 'start' })
}

export function cmdInput(
  b: Batch,
  cmd: Extract<Command, { type: 'setInput' | 'resetInput' }>,
): void {
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

export function cmdRun(b: Batch, cmd: Extract<Command, { type: 'run' }>): void {
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
    const pending =
      eligible(b.env.def, b.state, cmd.step) && awaitingWhen(b.env.def, b.state, cmd.step)
    reject(b, cmd, 'NOT_ACTIVE', pending ? 'when-pending' : 'not-ready')
    return
  }
  enterStep(b, cmd.step, null)
}

export function cmdRetry(b: Batch, cmd: Extract<Command, { type: 'retry' }>): void {
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
    idempotencyKey: currentIdempotencyKey(b, cmd.step, r.runId),
  })
}

/**
 * v0.2 (§10.2): `skip{step, reason?}` — a ready-or-active non-final step is skipped explicitly
 * (`step.skipped { reason: 'command' }`); an active step is cancelled first (a running task is
 * aborted, a wait's timers cleared, a child flow cancelled). The current view may be skipped
 * (it leaves without validation or `exit`) unless a transition is in flight from it.
 */
export function cmdSkip(b: Batch, cmd: Extract<Command, { type: 'skip' }>): void {
  const def = stepDef(b, cmd.step)
  const r = rec(b, cmd.step)
  if (def === undefined || r === undefined) {
    reject(b, cmd, 'UNKNOWN_STEP', 'unknown-step')
    return
  }
  if (def.kind === 'final') {
    reject(b, cmd, 'INVALID_COMMAND', 'final-step')
    return
  }
  if (r.status === 'active') {
    if (b.state.nav.phase !== 'idle' && b.state.nav.from === cmd.step) {
      reject(b, cmd, 'NAV_BUSY', 'nav-busy')
      return
    }
    // A view just leaves (no `exit`, no validation); every other kind is cancelled first
    // (the interpreter aborts a running task on `step.cancelled`).
    if (def.kind !== 'view') cancelStep(b, cmd.step, cmd.reason ?? 'skip')
  } else if (!eligible(b.env.def, b.state, cmd.step)) {
    reject(b, cmd, 'NOT_ACTIVE', r.pendingActivation ? 'not-ready' : `not-skippable:${r.status}`)
    return
  }
  skipStep(b, cmd.step, 'command')
}

const INVALIDATABLE: ReadonlySet<string> = new Set(['done', 'failed', 'skipped'])

/**
 * v0.2 (§10.3): `invalidate{step, cascade = true}` — a done/failed/skipped step returns to idle
 * (`step.invalidated { cause: 'command' }`); with `cascade`, every transitive `dependsOn`
 * dependent that is done/failed/skipped follows (`cause: 'cascade'`), running dependents are
 * cancelled first. Never automatic; active steps (the current view included) are rejected.
 */
export function cmdInvalidate(b: Batch, cmd: Extract<Command, { type: 'invalidate' }>): void {
  const def = stepDef(b, cmd.step)
  const r = rec(b, cmd.step)
  if (def === undefined || r === undefined) {
    reject(b, cmd, 'UNKNOWN_STEP', 'unknown-step')
    return
  }
  if (r.status === 'active') {
    reject(b, cmd, 'INVALID_COMMAND', cmd.step === b.state.current ? 'current-view' : 'active')
    return
  }
  if (!INVALIDATABLE.has(r.status)) {
    reject(b, cmd, 'INVALID_COMMAND', `not-invalidatable:${r.status}`)
    return
  }
  const cascade = cmd.cascade !== false
  emit(b, { type: 'step.invalidated', step: cmd.step, cascade, cause: 'command' })
  if (cascade) {
    for (const id of dependents(b, cmd.step)) {
      const dep = rec(b, id)
      if (dep === undefined) continue
      if (dep.status === 'active') cancelStep(b, id, 'invalidated')
      else if (!INVALIDATABLE.has(dep.status)) continue
      emit(b, { type: 'step.invalidated', step: id, cascade: true, cause: 'cascade' })
    }
  }
  schedule(b)
}

/** Transitive `dependsOn` dependents of `step`, in declaration order (excluding `step`). */
function dependents(b: Batch, step: string): readonly string[] {
  const def = b.env.def
  const found = new Set<string>([step])
  let grew = true
  while (grew) {
    grew = false
    for (const id of def.order) {
      if (found.has(id)) continue
      const deps = def.steps[id]?.dependsOn
      const list = deps === undefined ? [] : 'all' in deps ? deps.all : deps.any
      if (list.some((d) => found.has(d))) {
        found.add(id)
        grew = true
      }
    }
  }
  found.delete(step)
  return def.order.filter((id) => found.has(id))
}

export function cmdCancel(b: Batch, reason: string | undefined): void {
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

export function cmdCompensate(b: Batch, cmd: Extract<Command, { type: 'compensate' }>): void {
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

export function cmdReset(b: Batch): void {
  for (const timerId of Object.keys(b.state.timers)) emit(b, { type: 'timer.cleared', timerId })
  emit(b, { type: 'flow.reset' })
}

export function cmdChild(b: Batch, cmd: Extract<Command, { type: 'child' }>): void {
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
