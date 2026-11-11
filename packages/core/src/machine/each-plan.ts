/** Translate map facts to item-scoped calls and child creation. */
import type { HookName } from './commands'
import { eachItem } from './each-state'
import type { CallEffect, Effect } from './effects'
import type { DomainEvent } from './events'
import type { StepRecord, WizardState } from './state'
import type { MachineEnv } from './types'

function itemCall(
  env: MachineEnv,
  state: WizardState,
  rec: StepRecord,
  index: number,
  hook: HookName,
  extra?: Readonly<Record<string, unknown>>,
): CallEffect {
  const each = rec.each
  const item = each === undefined ? undefined : eachItem(each, index)
  const timeoutMs = env.def.steps[rec.id]?.timeoutMs
  return {
    kind: 'call',
    effectId: env.id('fx'),
    step: rec.id,
    hook,
    token: {
      step: rec.id,
      runId: rec.runId,
      itemIndex: index,
      itemGeneration: item?.generation ?? 0,
      attempt: item?.attempt ?? 1,
    },
    extra: {
      item: each?.items[index],
      index,
      attempt: item?.attempt ?? 1,
      idempotencyKey:
        item?.idempotencyKey ??
        `${state.instanceId}:${rec.id}:${rec.runId}:${each?.keys[index] ?? index}`,
      ...extra,
    },
    ...(hook === 'run' && timeoutMs !== undefined ? { timeoutMs } : {}),
  }
}

export function planEachEvent(
  env: MachineEnv,
  state: WizardState,
  ev: DomainEvent,
  out: Effect[],
): boolean {
  if (!ev.type.startsWith('step.each') || !('step' in ev)) return false
  const rec = state.steps[ev.step]
  if (rec?.each === undefined) return true
  if (ev.type === 'step.eachRetryScheduled') {
    const timer = state.timers[ev.timerId]
    if (timer !== undefined)
      out.push({ kind: 'timer.set', timerId: ev.timerId, at: timer.at, fire: timer.fire })
    return true
  }
  if (!('index' in ev)) return true
  const item = eachItem(rec.each, ev.index)
  if (rec.status !== 'active' || item.status !== 'running') return true
  switch (ev.type) {
    case 'step.eachItemStarted':
      if (item.attempt === ev.attempt)
        out.push(
          itemCall(
            env,
            state,
            rec,
            ev.index,
            env.def.steps[rec.id]?.hooks.idempotencyKey !== undefined &&
              item.idempotencyKey === undefined
              ? 'idempotencyKey'
              : rec.kind === 'child'
                ? 'childContext'
                : 'run',
          ),
        )
      break
    case 'step.eachItemKeyed':
      out.push(itemCall(env, state, rec, ev.index, rec.kind === 'child' ? 'childContext' : 'run'))
      break
    case 'step.eachMapErrorStarted':
      out.push(
        itemCall(env, state, rec, ev.index, 'mapError', {
          error: ev.error,
          ...(ev.timedOut === true ? { timedOut: true } : {}),
          ...(ev.syncViolation === true ? { syncViolation: true } : {}),
          ...(ev.failureKind !== undefined ? { failureKind: ev.failureKind } : {}),
        }),
      )
      break
    case 'step.eachChildStarted':
      out.push({ kind: 'child.create', step: ev.step, context: ev.context, itemIndex: ev.index })
      break
    case 'step.eachChildOutputRequested':
      out.push(itemCall(env, state, rec, ev.index, 'childOutput', { output: ev.output }))
      break
  }
  return true
}
