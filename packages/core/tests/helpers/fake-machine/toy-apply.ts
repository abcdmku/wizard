/** The toy machine's `apply` fold and status derivation. */

import type { DomainEvent } from '../../../src/machine/events'
import type { StepRecord, WizardState, WizardStatus } from '../../../src/machine/state'
import type { MachineEnv } from '../../../src/machine/types'
import { initialState } from './index'
import { TERMINAL } from './toy-shared'

export function toyApply(env: MachineEnv, S: WizardState, ev: DomainEvent): WizardState {
  const patchStep = (id: string, patch: Partial<StepRecord>): Record<string, StepRecord> => ({
    ...S.steps,
    [id]: { ...S.steps[id]!, ...patch },
  })
  let next: WizardState = S
  let terminal: WizardStatus | undefined
  switch (ev.type) {
    case 'flow.started':
      next = { ...S, startedAt: ev.at }
      break
    case 'step.arrived':
      next = { ...S, steps: patchStep(ev.step, { pendingActivation: true, arrivedSeq: ev.seq }) }
      break
    case 'step.entered': {
      const rec = S.steps[ev.step]!
      const { error: _e, output: _o, issues: _i, ...clean } = rec
      const entered: StepRecord = {
        ...clean,
        status: 'active',
        runId: ev.runId,
        attempt: 0,
        pendingActivation: false,
        enteredAt: ev.at,
        visitedCount: rec.visitedCount + 1,
      }
      const isView = rec.kind === 'view'
      next = {
        ...S,
        steps: { ...S.steps, [ev.step]: entered },
        current: isView ? ev.step : S.current,
        history: isView ? [...S.history, ev.step] : S.history,
      }
      break
    }
    case 'step.exited':
      next = {
        ...S,
        steps: patchStep(ev.step, { status: 'done', exitedAt: ev.at }),
        current: S.current === ev.step ? null : S.current,
      }
      break
    case 'step.done':
      next = {
        ...S,
        steps: patchStep(ev.step, {
          status: 'done',
          ...(ev.output !== undefined ? { output: ev.output } : {}),
        }),
        current: S.current === ev.step ? null : S.current,
      }
      break
    case 'step.failed':
      next = {
        ...S,
        steps: patchStep(ev.step, {
          status: 'failed',
          error: { ...ev.error, kind: ev.kind, at: ev.at },
        }),
      }
      break
    case 'step.cancelled':
      next = {
        ...S,
        steps: patchStep(ev.step, { status: 'cancelled' }),
        current: S.current === ev.step ? null : S.current,
      }
      break
    case 'step.runStarted':
      next = {
        ...S,
        steps: patchStep(ev.step, {
          attempt: ev.attempt,
          idempotencyKey: ev.idempotencyKey,
          status: 'active',
        }),
      }
      break
    case 'step.guardEvaluated':
      next = {
        ...S,
        steps: patchStep(ev.step, {
          guards: { ...S.steps[ev.step]!.guards, [ev.hook]: { ok: ev.ok, seq: ev.seq } },
        }),
      }
      break
    case 'transition.started':
      next = {
        ...S,
        nav: { phase: 'resolvingTarget', txId: ev.txId, from: ev.from, cause: ev.cause },
      }
      break
    case 'transition.phase':
      next = { ...S, nav: { ...S.nav, phase: ev.phase } }
      break
    case 'transition.committed':
    case 'transition.rejected':
    case 'transition.failed':
      next = { ...S, nav: { phase: 'idle' } }
      break
    case 'flow.done':
      terminal = 'done'
      next = { ...S, ...(ev.output !== undefined ? { output: ev.output } : {}) }
      break
    case 'flow.failed':
      terminal = 'failed'
      break
    case 'flow.cancelled':
      terminal = 'cancelled'
      break
    case 'flow.reset':
      return {
        ...initialState(env, {
          instanceId: S.instanceId,
          context: S.context,
          now: ev.at,
          epoch: S.epoch,
        }),
        seq: ev.seq,
        updatedAt: ev.at,
      }
    case 'context.changed':
      next = { ...S, context: { ...(S.context as object), ...(ev.patch as object) } }
      break
    case 'input.changed':
      next = {
        ...S,
        steps: patchStep(ev.step, {
          input: {
            ...((S.steps[ev.step]!.input as object | undefined) ?? {}),
            ...(ev.patch as object),
          },
        }),
      }
      break
    case 'event.received':
      // Provisional inbox entry; `event.buffered` keeps it (with expiry), delivered/expired/dropped remove it.
      next = {
        ...S,
        inbox: [
          ...S.inbox,
          { id: ev.inboxId, event: ev.event, payload: ev.payload, at: ev.at, expiresAt: 0 },
        ],
      }
      break
    case 'event.buffered':
      next = {
        ...S,
        inbox: S.inbox.map((e) => (e.id === ev.inboxId ? { ...e, expiresAt: ev.expiresAt } : e)),
      }
      break
    case 'event.delivered':
    case 'event.expired':
      next = { ...S, inbox: S.inbox.filter((e) => e.id !== ev.inboxId) }
      break
    case 'event.dropped':
      next = { ...S, inbox: S.inbox.filter((e) => e.expiresAt !== 0) }
      break
    case 'timer.scheduled':
      next = {
        ...S,
        timers: {
          ...S.timers,
          [ev.timerId]: {
            at: ev.dueAt,
            fire: { type: 'timer.fired', timerId: ev.timerId },
            purpose: ev.purpose,
          },
        },
      }
      break
    case 'timer.fired':
    case 'timer.cleared': {
      const { [ev.timerId]: _gone, ...rest } = S.timers
      next = { ...S, timers: rest }
      break
    }
    case 'child.summary':
      next = { ...S, steps: patchStep(ev.step, { child: ev.summary }) }
      break
    default:
      break
  }
  const active = Object.values(next.steps)
    .filter((r) => r.status === 'active')
    .map((r) => r.id)
  const status = terminal ?? (TERMINAL.has(S.status) ? S.status : deriveStatus(next, active))
  return { ...next, active, status, seq: ev.seq, updatedAt: ev.at }
}

function deriveStatus(S: WizardState, active: readonly string[]): WizardStatus {
  if (active.some((id) => ['task', 'decision', 'flow'].includes(S.steps[id]!.kind)))
    return 'running'
  if (active.length > 0) return 'waiting'
  return S.startedAt === null ? 'idle' : 'waiting'
}
