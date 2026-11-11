/** Results of one map item never overwrite another item's attempt or output. */
import type { Batch } from './batch'
import { emit, rec, stepDef } from './batch'
import type { EffectResult } from './commands'
import type { ResultMsg } from './decide/results'
import { backoffMs } from './decide/run-results'
import { eachRetryTimerId, fillEach } from './each'
import { eachItem, eachOutputs } from './each-state'
import { completeStep } from './nav'
import { failStep } from './scheduler'
import type { SerializedError } from './state'

function finishItem(b: Batch, step: string, index: number, output: unknown): void {
  emit(b, {
    type: 'step.eachItemCompleted',
    step,
    index,
    ...(output !== undefined ? { output } : {}),
  })
  const current = rec(b, step)
  if (current?.status !== 'active' || current.each === undefined) return
  if (current.each.done === current.each.items.length)
    completeStep(b, step, eachOutputs(current.each))
  else fillEach(b, step)
}

export function onEachResult(b: Batch, msg: ResultMsg): boolean {
  const step = msg.token.step
  const current = rec(b, step)
  const def = stepDef(b, step)
  if (current === undefined || def?.each === undefined) return false
  if (msg.hook === 'each') {
    if (current.status !== 'active' || current.each !== undefined) return false
    if (msg.type === 'res.err') {
      failStep(b, step, msg.error, msg.syncViolation === true ? 'sync-violation' : 'hook')
      return true
    }
    const value = msg.value
    if (
      typeof value !== 'object' ||
      value === null ||
      !('items' in value) ||
      !Array.isArray(value.items) ||
      !('keys' in value) ||
      !Array.isArray(value.keys)
    ) {
      failStep(
        b,
        step,
        {
          name: 'EachError',
          code: 'EACH_INVALID',
          message: `each of step '${step}' must return an array`,
        },
        'hook',
      )
      return true
    }
    emit(b, { type: 'step.eachStarted', step, items: value.items, keys: value.keys })
    if (value.items.length === 0) completeStep(b, step, [])
    else fillEach(b, step)
    return true
  }
  const index = msg.token.itemIndex
  if (index === undefined || current.each === undefined || current.runId !== msg.token.runId)
    return false
  const item = eachItem(current.each, index)
  if (
    item.status !== 'running' ||
    item.attempt !== msg.token.attempt ||
    (item.generation ?? 0) !== (msg.token.itemGeneration ?? 0)
  )
    return false
  if (current.status !== 'active' && current.status !== 'failed') return false
  if (msg.hook === 'idempotencyKey') {
    if (msg.type === 'res.ok') {
      const key =
        typeof msg.value === 'string' && msg.value.length > 0
          ? msg.value
          : `${b.state.instanceId}:${step}:${current.runId}:${current.each.keys[index] ?? index}`
      emit(b, { type: 'step.eachItemKeyed', step, index, key })
    } else recordFailure(b, step, index, msg, msg.error, undefined, false)
    return true
  }
  if (msg.hook === 'childContext' && msg.type === 'res.ok') {
    emit(b, { type: 'step.eachChildStarted', step, index, context: msg.value })
    return true
  }
  if (msg.hook === 'mapError') {
    if (
      msg.type === 'res.err' &&
      (msg.error.code === 'INVALID_MAP_ERROR' || msg.syncViolation === true)
    ) {
      recordFailure(b, step, index, msg, msg.error, undefined, false)
      return true
    }
    const original = msg.extra?.error
    const error =
      typeof original === 'object' &&
      original !== null &&
      'name' in original &&
      typeof original.name === 'string' &&
      'message' in original &&
      typeof original.message === 'string'
        ? {
            name: original.name,
            message: original.message,
            ...('code' in original && typeof original.code === 'string'
              ? { code: original.code }
              : {}),
          }
        : { name: 'Error', message: 'unknown item failure' }
    recordFailure(
      b,
      step,
      index,
      msg,
      error,
      msg.type === 'res.ok' ? msg.value : undefined,
      msg.retryable !== false,
    )
    return true
  }
  if (msg.type === 'res.ok') {
    finishItem(b, step, index, msg.value)
    return true
  }
  if (
    msg.hook === 'run' &&
    current.status === 'active' &&
    msg.cancelled !== true &&
    def.hooks.mapError !== undefined &&
    msg.error.code !== 'INVALID_RUN_ERROR'
  ) {
    emit(b, {
      type: 'step.eachMapErrorStarted',
      step,
      index,
      attempt: item.attempt,
      error: msg.error,
      ...(msg.timedOut === true ? { timedOut: true } : {}),
      ...(msg.syncViolation === true ? { syncViolation: true } : {}),
      ...(msg.failure?.kind !== undefined ? { failureKind: msg.failure.kind } : {}),
    })
  } else recordFailure(b, step, index, msg, msg.error, msg.failure?.data, msg.retryable !== false)
  return true
}

function recordFailure(
  b: Batch,
  step: string,
  index: number,
  msg: ResultMsg,
  raw: SerializedError,
  data: unknown,
  retryable: boolean,
): void {
  const current = rec(b, step)
  const def = stepDef(b, step)
  if (current?.each === undefined || def === undefined) return
  const item = eachItem(current.each, index)
  const policy = def.retry ?? b.env.def.policies.retry
  const violation =
    (msg.type === 'res.err' && msg.syncViolation === true) || msg.extra?.syncViolation === true
  const timedOut = (msg.type === 'res.err' && msg.timedOut === true) || msg.extra?.timedOut === true
  const mappedKind =
    msg.extra?.failureKind === 'typed' ||
    msg.extra?.failureKind === 'defect' ||
    msg.extra?.failureKind === 'interrupted'
      ? msg.extra.failureKind
      : undefined
  const kind = violation
    ? 'sync-violation'
    : timedOut
      ? 'timeout'
      : msg.hook === 'mapError' && msg.type === 'res.err' && msg.error.code === 'INVALID_MAP_ERROR'
        ? 'hook'
        : msg.hook === 'childContext' && def.kind === 'flow'
          ? 'child'
          : msg.type === 'res.err'
            ? (msg.failure?.kind ?? mappedKind ?? 'run')
            : (mappedKind ?? 'run')
  const willRetry =
    current.status === 'active' && !violation && retryable && item.attempt <= (policy?.retries ?? 0)
  const error = data === undefined ? raw : { ...raw, data }
  emit(b, {
    type: 'step.eachItemFailed',
    step,
    index,
    attempt: item.attempt,
    error,
    willRetry,
    kind,
    ...(data !== undefined ? { data } : {}),
  })
  if (willRetry) {
    emit(b, {
      type: 'step.eachRetryScheduled',
      step,
      index,
      attempt: item.attempt + 1,
      dueAt: b.env.now() + backoffMs(b, policy, item.attempt),
      timerId: eachRetryTimerId(step, index),
    })
    fillEach(b, step)
  } else if (current.status === 'active') failStep(b, step, error, kind, data)
}

export function onEachChildResult(
  b: Batch,
  msg: Extract<EffectResult, { type: 'res.child' }>,
): boolean {
  const index = msg.token.itemIndex
  const current = rec(b, msg.step)
  const def = stepDef(b, msg.step)
  if (
    index === undefined ||
    current?.each === undefined ||
    def?.each === undefined ||
    current.runId !== msg.token.runId
  )
    return false
  const item = eachItem(current.each, index)
  if (
    item.status !== 'running' ||
    item.attempt !== msg.token.attempt ||
    (item.generation ?? 0) !== (msg.token.itemGeneration ?? 0) ||
    msg.summary.seq <= (item.child?.seq ?? -1)
  )
    return false
  emit(b, { type: 'step.eachChildSummary', step: msg.step, index, summary: msg.summary })
  if (msg.done !== undefined) {
    if (def.hooks.childOutput !== undefined)
      emit(b, {
        type: 'step.eachChildOutputRequested',
        step: msg.step,
        index,
        output: msg.done.output,
      })
    else finishItem(b, msg.step, index, msg.done.output)
  } else if (msg.failed !== undefined || msg.summary.status === 'halted') {
    const error = msg.failed?.error ?? {
      name: 'ChildHaltedError',
      code: 'CHILD_HALTED',
      message: `child item ${index} halted`,
    }
    recordFailure(
      b,
      msg.step,
      index,
      {
        type: 'res.err',
        effectId: '',
        hook: 'childContext',
        token: msg.token,
        error,
        durationMs: 0,
      },
      error,
      msg.failed?.data,
      true,
    )
  }
  return true
}
