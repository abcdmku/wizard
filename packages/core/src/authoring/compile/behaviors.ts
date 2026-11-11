/** Runnable, mapped, waiting and durable delay behavior. @internal */
import { parseDuration } from '../duration'
import type { AnyStep, Duration } from '../types'
import { compileChild } from './child'
import { asHook, chain, hookField } from './hooks'
import { durationMs } from './policies'
import { compileRunStep } from './run'
import { isRecord, type Rec } from './shared'
import { eventHandlers } from './step-hooks'
import type { Problem, StepBuild, StepCtx, StepHooks } from './steps'

export function compileBehaviors(
  raw: AnyStep,
  c: Rec,
  step: StepBuild,
  hooks: StepHooks,
  problem: Problem,
  sc: StepCtx,
): void {
  if (c.each !== undefined) compileEach(c, step, problem)
  else
    for (const field of ['concurrency', 'key']) {
      if (c[field] !== undefined) problem(`'${field}' requires 'each'`)
    }
  if (raw.kind === 'flow') {
    compileChild(raw, c, step, hooks, problem, sc)
    return
  }
  const behaviors = ['run', 'waitFor', 'sleep'].filter((field) => c[field] !== undefined)
  if (behaviors.length > 1) problem("a step has one behavior: 'run', 'waitFor', or 'sleep'")
  if (c.run !== undefined) {
    compileRunStep(c, step, hooks, problem)
    return
  }
  for (const field of [
    'output',
    'retry',
    'compensate',
    'idempotencyKey',
    'mapError',
    'fallback',
    'each',
  ]) {
    if (c[field] !== undefined) problem(`'${field}' requires 'run'`)
  }
  if (c.waitFor !== undefined) {
    hooks.waitFor = eventHandlers(c.waitFor, 'waitFor', problem, sc)
    compileWaitTimeout(c.timeout, step, problem, sc)
    return
  }
  if (c.timeout !== undefined) problem("'timeout' requires 'run' or 'waitFor'")
  if (c.sleep !== undefined) {
    if (typeof c.sleep === 'function') {
      const sleep = asHook<Duration>(c.sleep as (args: never) => unknown)
      step.sleep = (args) => chain(sleep(args), (value) => parseDuration(value))
    } else {
      const ms = durationMs(c.sleep, 'sleep', problem)
      if (ms !== undefined) step.sleep = ms
    }
    return
  }
}

function compileEach(c: Rec, step: StepBuild, problem: Problem): void {
  hookField(c.each, 'each', problem, (items) => {
    const concurrency = c.concurrency === undefined ? Number.POSITIVE_INFINITY : c.concurrency
    if (
      typeof concurrency !== 'number' ||
      Number.isNaN(concurrency) ||
      concurrency < 1 ||
      (Number.isFinite(concurrency) && !Number.isInteger(concurrency))
    )
      problem("'concurrency' must be a positive integer or Infinity")
    if (c.key !== undefined && typeof c.key !== 'function') problem("'key' must be a function")
    step.each = {
      items: asHook<readonly unknown[]>(items),
      concurrency:
        typeof concurrency === 'number' && concurrency >= 1
          ? concurrency
          : Number.POSITIVE_INFINITY,
      ...(typeof c.key === 'function'
        ? { key: c.key as (item: unknown, index: number) => string }
        : {}),
    }
  })
}

function compileWaitTimeout(
  timeout: unknown,
  step: StepBuild,
  problem: Problem,
  sc: StepCtx,
): void {
  if (timeout === undefined) return
  if (!isRecord(timeout) || typeof timeout.next !== 'string') {
    problem("'timeout' must be { after: Duration, next: stepReference }")
    return
  }
  const afterMs = durationMs(timeout.after, 'timeout.after', problem)
  if (!sc.ids.has(timeout.next)) problem(`timeout.next: unknown step '${timeout.next}'`)
  if (afterMs !== undefined) {
    step.waitTimeout = { afterMs, next: timeout.next }
    sc.graph.edges(step.id, [timeout.next])
  }
}
