/** Map scheduling: an initial cursor visits each item once, independently of completion order. */
import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import { type EachState, eachItem } from './each-state'
import { failStep } from './scheduler'

export const eachRetryTimerId = (step: string, index: number): string =>
  `each-retry:${encodeURIComponent(step)}:${index}`

export function fillEach(b: Batch, step: string): void {
  const def = stepDef(b, step)
  let current = rec(b, step)
  if (def?.each === undefined || current?.status !== 'active' || current.each === undefined) return
  let cursor = current.each.cursor
  while (
    current.each !== undefined &&
    current.each.running < def.each.concurrency &&
    cursor < current.each.items.length
  ) {
    const item = eachItem(current.each, cursor)
    if (item.status === 'pending') {
      emit(b, { type: 'step.eachItemStarted', step, index: cursor, attempt: item.attempt + 1 })
      current = rec(b, step)
      if (current?.status !== 'active') return
    }
    cursor++
  }
}

export function retryEach(b: Batch, step: string): void {
  const each = rec(b, step)?.each
  if (each === undefined) return
  const indices: number[] = []
  for (let index = 0; index < each.items.length; index++) {
    const item = eachItem(each, index)
    if (item.status !== 'failed' && item.status !== 'retrying') continue
    indices.push(index)
    const timerId = eachRetryTimerId(step, index)
    if (b.state.timers[timerId] !== undefined) emit(b, { type: 'timer.cleared', timerId })
  }
  emit(b, { type: 'step.eachRetryRequested', step, indices, resetAttempts: true })
  fillEach(b, step)
}

export function onEachTimer(b: Batch, timerId: string): boolean {
  if (!timerId.startsWith('each-retry:')) return false
  const timer = b.state.timers[timerId]
  const index = Number(timerId.slice(timerId.lastIndexOf(':') + 1))
  const step = timer?.step
  if (step === undefined) return true
  emit(b, { type: 'timer.fired', timerId })
  const current = rec(b, step)
  if (current?.status !== 'active' || current.each === undefined) return true
  const item = eachItem(current.each, index)
  if (item.status !== 'retrying') return true
  emit(b, { type: 'step.eachRetryRequested', step, indices: [index] })
  fillEach(b, step)
  return true
}

export function resumeEach(b: Batch, step: string, original?: EachState): void {
  const current = rec(b, step)
  const def = stepDef(b, step)
  if (
    current?.each === undefined ||
    def?.each === undefined ||
    (current.status !== 'active' && current.status !== 'failed')
  )
    return
  let interrupted: { name: string; message: string; code: string } | undefined
  for (let index = 0; index < current.each.items.length; index++) {
    const item = eachItem(current.each, index)
    if (item.status !== 'running') continue
    if (original !== undefined) {
      const before = eachItem(original, index)
      if (
        before.status !== 'running' ||
        before.attempt !== item.attempt ||
        (before.generation ?? 0) !== (item.generation ?? 0)
      )
        continue
    }
    // A halted map has no live executor after restart. Its unfinished ordinary calls must be
    // eligible for manual retry too, while already completed items remain untouched.
    if (current.status === 'failed' && def.kind !== 'flow') {
      const error = {
        name: 'InterruptedError',
        message: `item ${index} interrupted by a restart`,
        code: 'INTERRUPTED',
      }
      emit(b, {
        type: 'step.eachItemFailed',
        step,
        index,
        attempt: item.attempt,
        error,
        willRetry: false,
        kind: 'interrupted',
      })
      continue
    }
    // Children are restored separately. Ordinary maps resume only the unfinished item calls.
    if (def.kind === 'flow' && item.child !== undefined) {
      if (item.child.status === 'done' && def.hooks.childOutput !== undefined)
        emit(b, { type: 'step.eachChildOutputRequested', step, index, output: item.output })
      continue
    }
    if (def.kind === 'flow') {
      emit(b, { type: 'step.eachItemStarted', step, index, attempt: item.attempt, resumed: true })
      continue
    }
    if (def.idempotent !== true) {
      const error = {
        name: 'InterruptedError',
        message: `item ${index} interrupted by a restart`,
        code: 'INTERRUPTED',
      }
      emit(b, {
        type: 'step.eachItemFailed',
        step,
        index,
        attempt: item.attempt,
        error,
        willRetry: false,
        kind: 'interrupted',
      })
      interrupted ??= error
      continue
    }
    emit(b, { type: 'step.eachItemStarted', step, index, attempt: item.attempt, resumed: true })
  }
  if (interrupted !== undefined && current.status === 'active') {
    failStep(b, step, interrupted, 'interrupted')
    return
  }
  fillEach(b, step)
}
