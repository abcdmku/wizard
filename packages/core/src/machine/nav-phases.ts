/**
 * Navigation phase machine (§1.2): the phase list per cause, the walk from one phase to the next
 * (skip arrows decided here, effects planned by `plan`), target resolution, and the results of
 * the transaction hooks (`parseInput` / `validate` / `canExit` / `next` / `canEnter` / `exit` /
 * `enter`). `commit` and the rejections live in `nav.ts`.
 *
 * @internal
 */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import type { EffectResult } from './commands'
import { commit, failCurrent, rejectCurrent } from './nav'
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
      return PHASES_TARGETED
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
      // A skipped `from` (v0.2) never entered: its `exit` hook does not run.
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
  // A decision's output IS its target list — unless it was skipped (v0.2): then its `next`
  // hook is asked like any dynamic `next`.
  if (def.kind === 'decision' && rec(b, from ?? '')?.status !== 'skipped')
    return applyTargets(b, from, normalizeTargets(rec(b, from ?? '')?.output))
  if (def.next.kind === 'dynamic') {
    phaseEvent(b, 'resolvingTarget')
    return 'wait'
  }
  const targets = def.next.kind === 'static' ? def.next.targets : []
  return applyTargets(b, from, targets)
}

/** Record resolved targets (validated) via the `resolvingTarget` phase event. */
function applyTargets(b: Batch, from: string | null, targets: readonly string[]): PhaseOutcome {
  if (targets.length === 0) {
    phaseEvent(b, 'resolvingTarget')
    rejectCurrent(b, 'no-target', from !== null ? { step: from } : {})
    return 'stop'
  }
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
        const targets = normalizeTargets(value)
        if (targets.length === 0) {
          rejectCurrent(b, 'no-target', { step: from })
        } else {
          const unknown = targets.find((t) => stepDef(b, t) === undefined)
          if (unknown !== undefined) {
            failCurrent(b, from, unknownTarget(unknown))
          } else {
            runPhases(b, 'canEnter', targets)
          }
        }
      } else {
        failCurrent(b, from, error)
      }
      return true
    }
    case 'canEnter': {
      const step = msg.token.step
      if (nav.phase !== 'canEnter' || !(nav.pendingSteps ?? []).includes(step)) return false
      if (guardEvaluated(b, step, 'canEnter', ok, value, error)) {
        if ((b.state.nav.pendingSteps?.length ?? 0) === 0) runPhases(b, 'exiting')
      } else rejectCurrent(b, 'guard-canEnter', { step })
      return true
    }
    case 'exit': {
      if (nav.phase !== 'exiting' || from === null) return false
      if (ok) runPhases(b, 'entering')
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
