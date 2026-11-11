/** Compile the fields used by a runnable step. @internal */

import { isBoundary, toRuntimeBoundary } from '../boundary'
import type { CompiledStep, Hook } from '../compiled'
import { isRunAdapter, RUN_ADAPTER } from '../run-adapter'
import { asHook, chain, hookField } from './hooks'
import { compileRetry, durationMs } from './policies'
import type { Mutable, Rec } from './shared'

type Build = Mutable<CompiledStep>
type Hooks = Mutable<CompiledStep['hooks']>
type Problem = (message: string) => void

export function compileRunStep(s: Rec, step: Build, hooks: Hooks, problem: Problem): void {
  const adapter = isRunAdapter(s.run) ? s.run : undefined
  if (adapter !== undefined) {
    hooks.run = asHook<unknown>(adapter[RUN_ADAPTER].run as (args: never) => unknown)
    if (isBoundary(adapter[RUN_ADAPTER].output))
      step.output = toRuntimeBoundary(adapter[RUN_ADAPTER].output)
    else problem('run adapter output must be a boundary')
  }
  if (s.output !== undefined) {
    if (isBoundary(s.output)) step.output = toRuntimeBoundary(s.output)
    else problem("'output' must be a boundary")
  }
  if (adapter === undefined) {
    if (typeof s.run !== 'function') problem("'run' must be a function or a run adapter")
    else hooks.run = asHook<unknown>(s.run as (args: never) => unknown)
  }
  if (s.retry !== undefined) {
    const retry = compileRetry(s.retry, 'retry', problem)
    if (retry !== undefined) step.retry = retry
  }
  if (s.timeout !== undefined) {
    const ms = durationMs(s.timeout, 'timeout', problem)
    if (ms !== undefined) step.timeoutMs = ms
  }
  hookField(s.compensate, 'compensate', problem, (h) => {
    hooks.compensate = (args) => (h as Hook<void>)({ ...args, reason: args.reason ?? undefined })
  })
  const idempotent = s.idempotent
  if (idempotent !== undefined) {
    if (idempotent === true) step.idempotent = true
    else if (typeof idempotent === 'function') {
      step.idempotent = true
      hooks.idempotencyKey = (args) =>
        chain(asHook<unknown>(idempotent as (args: never) => unknown)(args), (key): string => {
          if (typeof key !== 'string' || key.length === 0) {
            throw new TypeError('an idempotency key function must return a non-empty string')
          }
          return key
        })
    } else if (idempotent !== false) {
      problem("'idempotent' must be true, false or a function returning the key")
    }
  }
  hookField(s.mapError, 'mapError', problem, (h) => {
    const mapError = h as unknown as (error: unknown, args: unknown) => unknown
    hooks.mapError = (args) => mapError(args.error, args)
  })
}
