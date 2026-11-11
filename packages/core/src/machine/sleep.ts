/** Durable sleep evaluation and absolute timer completion. @internal */

import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import type { EffectResult } from './commands'
import { completeStep } from './nav'
import { failStep } from './scheduler'

export const sleepTimerId = (step: string) => `sleep:${step}`

/** A dynamic duration is planned as a hook; a static duration is recorded immediately. */
export function startSleep(b: Batch, step: string): void {
  const def = stepDef(b, step)
  const record = rec(b, step)
  if (def?.sleep === undefined || record?.status !== 'active' || record.deadline !== undefined)
    return
  if (typeof def.sleep === 'number') scheduleSleep(b, step, def.sleep)
}

export function onSleepResult(
  b: Batch,
  msg: Extract<EffectResult, { type: 'res.ok' | 'res.err' }>,
): boolean {
  const step = msg.token.step
  const record = rec(b, step)
  if (
    stepDef(b, step)?.sleep === undefined ||
    record?.status !== 'active' ||
    record.entering === true ||
    record.deadline !== undefined
  )
    return false
  if (msg.type === 'res.err') {
    failStep(b, step, msg.error, msg.syncViolation === true ? 'sync-violation' : 'hook')
  } else scheduleSleep(b, step, msg.value)
  return true
}

function scheduleSleep(b: Batch, step: string, duration: unknown): void {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    failStep(
      b,
      step,
      {
        name: 'WizardError',
        code: 'INVALID_SLEEP',
        message: `sleep of step '${step}' must be a finite nonnegative duration`,
      },
      'hook',
    )
    return
  }
  if (duration === 0) {
    completeStep(b, step, undefined)
    return
  }
  emit(b, {
    type: 'timer.scheduled',
    timerId: sleepTimerId(step),
    dueAt: b.env.now() + duration,
    purpose: 'sleep',
    step,
  })
}

export function onSleepTimer(b: Batch, step: string): void {
  const record = rec(b, step)
  if (record?.status !== 'active' || stepDef(b, step)?.sleep === undefined) return
  completeStep(b, step, undefined)
}
