/**
 * Navigation phase machine: the phase list per cause, the walk from one phase to the next
 * (skip arrows decided here, effects planned by `plan`), target resolution, and the results of
 * the transaction hooks (`parseInput` / `validate` / `canExit` / `next` / `canEnter` / `exit` /
 * `enter`). `commit` and the rejections live in `nav.ts`.
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import type { EffectResult } from './commands'
import { abortCurrent, commit, failCurrent, rejectCurrent } from './nav'
import type { Issue, NavPhase, SerializedError } from './state'
import { normalizeTargets, unknownTarget } from './util'

const PHASES_FULL: readonly NavPhase[] = [
  'parsingInput',
  'validating',
  'canExit',
  'resolvingTarget',
  'canEnter',
  'exiting',
  'entering',
]
const PHASES_TARGETED: readonly NavPhase[] = ['canEnter', 'exiting', 'entering']
/** `back` leaves the current view without validating or exiting it: its draft is kept. */
const PHASES_BACK: readonly NavPhase[] = ['canEnter', 'entering']
const PHASES_AUTO: readonly NavPhase[] = ['resolvingTarget', 'canEnter', 'exiting', 'entering']

export function phaseList(b: Batch): readonly NavPhase[] {
  const nav = b.state.nav
  const fromIsView = nav.from != null && stepDef(b, nav.from)?.kind === 'view'
  switch (nav.cause) {
    case 'next':
      return PHASES_FULL
    case 'go':
      return fromIsView ? PHASES_FULL : PHASES_TARGETED
    case 'back':
      return PHASES_BACK
    default:
      // cursor rule (from null) vs. auto-advance from a completed non-view step
      return nav.from == null ? PHASES_TARGETED : PHASES_AUTO
  }
}

// ---------------------------------------------------------------------------
// Phase machine
// ---------------------------------------------------------------------------

type PhaseOutcome = 'wait' | 'continue' | 'stop'

/** Walk phases from `start`; stop when a phase needs an effect result (or the tx ended); commit at the end. */
export function runPhases(b: Batch, start: NavPhase, targets?: readonly string[]): void {
  const list = phaseList(b)
  let i = list.indexOf(start)
  if (i < 0) return
  let known = targets
  while (i < list.length) {
    const phase = list[i]
    if (phase === undefined) return
    const outcome = enterPhase(b, phase, known)
    known = undefined
    if (outcome !== 'continue') return
    i++
  }
  commit(b)
}

/** Run the phases after `phase` in this transaction's list (commit when it was the last). */
function continueAfter(b: Batch, phase: NavPhase): void {
  const list = phaseList(b)
  const next = list[list.indexOf(phase) + 1]
  if (next === undefined) commit(b)
  else runPhases(b, next)
}

function phaseEvent(b: Batch, phase: NavPhase, targets?: readonly string[]): void {
  emit(b, {
    type: 'transition.phase',
    txId: b.state.nav.txId ?? '',
    phase,
    ...(targets !== undefined ? { targets } : {}),
  })
}

function enterPhase(b: Batch, phase: NavPhase, targets?: readonly string[]): PhaseOutcome {
  const from = b.state.nav.from ?? null
  const fromDef = from !== null ? stepDef(b, from) : undefined
  switch (phase) {
    case 'parsingInput': {
      phaseEvent(b, phase)
      if (fromDef?.input !== undefined) return 'wait'
      if (from !== null) {
        const input = rec(b, from)?.input
        emit(b, { type: 'step.validated', step: from, output: input })
      }
      return 'continue'
    }
    case 'validating':
      phaseEvent(b, phase)
      return fromDef?.hooks.validate !== undefined ? 'wait' : 'continue'
    case 'canExit':
      phaseEvent(b, phase)
      return fromDef?.hooks.canExit !== undefined ? 'wait' : 'continue'
    case 'resolvingTarget':
      return resolveTargets(b, from, targets)
    case 'canEnter':
      phaseEvent(b, phase, targets)
      return (b.state.nav.pendingSteps?.length ?? 0) > 0 ? 'wait' : 'continue'
    case 'exiting':
      phaseEvent(b, phase)
      // A skipped `from` produced no output (`when`, `skip`, `fallback`, a wait timeout): its
      // `exit` hook does not run.
      return fromDef?.hooks.exit !== undefined && rec(b, from ?? '')?.status !== 'skipped'
        ? 'wait'
        : 'continue'
    case 'entering':
      phaseEvent(b, phase)
      return (b.state.nav.pendingSteps?.length ?? 0) > 0 ? 'wait' : 'continue'
    default:
      return 'stop'
  }
}

function resolveTargets(b: Batch, from: string | null, known?: readonly string[]): PhaseOutcome {
  const nav = b.state.nav
  if (known !== undefined) return applyTargets(b, from, known)
  if (nav.targets !== undefined) {
    phaseEvent(b, 'resolvingTarget')
    return 'continue'
  }
  const def = from !== null ? stepDef(b, from) : undefined
  if (def === undefined) {
    phaseEvent(b, 'resolvingTarget')
    rejectCurrent(b, 'no-target')
    return 'stop'
  }
  if (def.next.kind === 'dynamic') {
    phaseEvent(b, 'resolvingTarget')
    return 'wait'
  }
  const targets = def.next.kind === 'static' ? def.next.targets : []
  return applyTargets(b, from, targets)
}

/** Record resolved targets (validated) via the `resolvingTarget` phase event. */
function applyTargets(b: Batch, from: string | null, targets: readonly string[]): PhaseOutcome {
  const unknown = targets.find((t) => stepDef(b, t) === undefined)
  if (unknown !== undefined) {
    phaseEvent(b, 'resolvingTarget')
    failCurrent(b, from ?? unknown, unknownTarget(unknown))
    return 'stop'
  }
  phaseEvent(b, 'resolvingTarget', targets)
  return 'continue'
}

// ---------------------------------------------------------------------------
// Effect results for transaction hooks (token.txId === nav.txId, checked by the caller)
// ---------------------------------------------------------------------------

/** Record a guard result (`step.guardEvaluated`); `false` and a throw both veto (the throw's message is the reason). */
function guardEvaluated(
  b: Batch,
  step: string,
  hook: 'canEnter' | 'canExit',
  ok: boolean,
  value: unknown,
  error: SerializedError,
): boolean {
  const passed = ok && value !== false
  emit(b, {
    type: 'step.guardEvaluated',
    step,
    hook,
    ok: passed,
    ...(ok ? {} : { reason: error.message }),
  })
  return passed
}

export function onNavResult(
  b: Batch,
  msg: Extract<EffectResult, { type: 'res.ok' | 'res.err' }>,
): boolean {
  const nav = b.state.nav
  const from = nav.from ?? null
  const ok = msg.type === 'res.ok'
  if (!ok && msg.cancelled === true) {
    abortCurrent(b, msg.token.step)
    return true
  }
  const value = ok ? msg.value : undefined
  const error: SerializedError = ok ? { name: 'Error', message: '' } : msg.error
  switch (msg.hook) {
    case 'parseInput': {
      if (nav.phase !== 'parsingInput' || from === null) return false
      if (ok) {
        emit(b, { type: 'step.validated', step: from, output: value })
        runPhases(b, 'validating')
      } else {
        const issues = msg.issues ?? [{ message: error.message }]
        emit(b, { type: 'step.validationFailed', step: from, issues })
        rejectCurrent(b, 'validation', { step: from, issues })
      }
      return true
    }
    case 'validate': {
      if (nav.phase !== 'validating' || from === null) return false
      const issues: readonly Issue[] | undefined = ok
        ? Array.isArray(value) && value.length > 0
          ? (value as readonly Issue[])
          : undefined
        : (msg.issues ?? [{ message: error.message }])
      if (issues === undefined) {
        runPhases(b, 'canExit')
      } else {
        emit(b, { type: 'step.validationFailed', step: from, issues })
        rejectCurrent(b, 'validation', { step: from, issues })
      }
      return true
    }
    case 'canExit': {
      if (nav.phase !== 'canExit' || from === null) return false
      if (guardEvaluated(b, from, 'canExit', ok, value, error)) runPhases(b, 'resolvingTarget')
      else rejectCurrent(b, 'guard-canExit', { step: from })
      return true
    }
    case 'next': {
      if (nav.phase !== 'resolvingTarget' || from === null) return false
      if (ok) {
        const error = nextTargetsError(b, from, value)
        if (error !== undefined) failCurrent(b, from, error)
        else runPhases(b, 'canEnter', normalizeTargets(value))
      } else {
        failCurrent(b, from, error)
      }
      return true
    }
    case 'canEnter': {
      const step = msg.token.step
      if (nav.phase !== 'canEnter' || !(nav.pendingSteps ?? []).includes(step)) return false
      if (guardEvaluated(b, step, 'canEnter', ok, value, error)) {
        if ((b.state.nav.pendingSteps?.length ?? 0) === 0) continueAfter(b, 'canEnter')
      } else rejectCurrent(b, 'guard-canEnter', { step })
      return true
    }
    case 'exit': {
      if (nav.phase !== 'exiting' || from === null) return false
      if (ok) continueAfter(b, 'exiting')
      else failCurrent(b, from, error)
      return true
    }
    case 'enter': {
      const step = msg.token.step
      if (nav.phase !== 'entering' || !(nav.pendingSteps ?? []).includes(step)) return false
      if (ok) {
        // Atomic multi-target entry: commit only once every target's `enter` resolved.
        emit(b, { type: 'step.enterCompleted', step })
        if ((b.state.nav.pendingSteps?.length ?? 0) === 0) commit(b)
      } else failCurrent(b, step, error)
      return true
    }
    default:
      return false
  }
}

/** Runtime hook results must name existing steps within their declared target list. */
export function nextTargetsError(
  b: Batch,
  step: string,
  value: unknown,
): SerializedError | undefined {
  if (
    value !== null &&
    typeof value !== 'string' &&
    (!Array.isArray(value) || value.some((target) => typeof target !== 'string'))
  )
    return {
      name: 'WizardError',
      code: 'INVALID_NEXT_TARGET',
      message: `next() of '${step}' must return a step id, an array of step ids, or null`,
    }
  const targets = normalizeTargets(value)
  const unknown = targets.find((target) => stepDef(b, target) === undefined)
  if (unknown !== undefined) return unknownTarget(unknown)
  const next = stepDef(b, step)?.next
  if (next?.kind !== 'dynamic' || next.targets === undefined) return undefined
  const declared = new Set(next.targets)
  const undeclared = targets.find((target) => !declared.has(target))
  return undeclared === undefined
    ? undefined
    : {
        name: 'WizardError',
        code: 'UNDECLARED_TARGET',
        message: `next() of '${step}' selected undeclared target '${undeclared}'`,
      }
}
