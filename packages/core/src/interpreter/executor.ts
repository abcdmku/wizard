/**
 * Hook executor: runs `call` effects.
 *
 * - Builds `HookArgs` from state + step + effect extras and calls the hook.
 * - Non-thenable results are reported synchronously (`res.ok` enqueued in the
 *   same drain); thenables settle later. Under `strict: 'sync'` a thenable is a
 *   `res.err { syncViolation: true }`.
 * - `parseInput` runs the view's `input` boundary over the draft; `run` pipes
 *   the hook value through the optional `output` boundary; `childContext`
 *   pipes the mapped context through the child flow's `context` boundary;
 *   `on` resolves `hooks.on[extra.event]`; `flowOn` (v0.2) resolves the
 *   flow-level `def.on[extra.event]` (no step: the effect's `step` is `''`);
 *   `mapError` (v0.2) receives the RAW value the failed `run` threw as
 *   `args.error` when it is still known (same step/runId/attempt), else the
 *   serialized form the machine put in `extra`. Every result echoes the effect's
 *   `extra` (`res.ok/res.err.extra`) so the machine gets its routing data back.
 * - `timeoutMs` arms a scheduler timer → abort + `res.err { timedOut: true }`.
 *   A `settled` flag guarantees one report per effect (late results after a
 *   timeout are dropped; the machine's token check covers everything else).
 * - `abort(step)` (cancel/compensate/flow-done) aborts the signal but lets the
 *   hook settle cooperatively — bounded by a grace timer when no `timeoutMs`
 *   is set (plan §8.5).
 *
 * @internal
 */

import type { CompiledStep } from '../authoring/compiled'
import { WizardError } from '../errors'
import type { ContextUpdater, EffectResult, ResultToken } from '../machine/commands'
import type { CallEffect } from '../machine/effects'
import {
  BoundaryRejection,
  codedError,
  invalidErrorData,
  normalizeRunFailure,
  toSerializedError,
} from './errors'
import { abortCalls } from './executor-abort'
import { invoke, invokeFlowOn, noop, retryRejected } from './executor-invoke'
import {
  DEFAULT_ABORT_GRACE_MS,
  type Executor,
  type ExecutorOptions,
  type InFlight,
  type RawFailure,
} from './executor-types'
import { buildHookArgs } from './hook-args'
import { getThen, type Then } from './thenable'

export type { Executor, ExecutorOptions } from './executor-types'

export function createExecutor(opts: ExecutorOptions): Executor {
  const byId = new Map<string, InFlight>()
  const byStep = new Map<string, Set<InFlight>>()
  const graceMs = opts.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS
  const rawFailures = new Map<string, RawFailure>()

  const track = (inf: InFlight): void => {
    byId.set(inf.effect.effectId, inf)
    let set = byStep.get(inf.effect.step)
    if (set === undefined) {
      set = new Set()
      byStep.set(inf.effect.step, set)
    }
    set.add(inf)
  }

  const untrack = (inf: InFlight): void => {
    byId.delete(inf.effect.effectId)
    const set = byStep.get(inf.effect.step)
    if (set !== undefined) {
      set.delete(inf)
      if (set.size === 0) byStep.delete(inf.effect.step)
    }
    if (inf.timeout !== undefined) {
      opts.scheduler.clearTimeout(inf.timeout)
      inf.timeout = undefined
    }
    if (inf.grace !== undefined) {
      opts.scheduler.clearTimeout(inf.grace)
      inf.grace = undefined
    }
  }

  const settle = (inf: InFlight, msg: EffectResult): void => {
    if (inf.settled) return
    inf.settled = true
    untrack(inf)
    opts.send(msg, inf.causedBy)
  }

  /** Event identity and buffered wait updates travel back with their settled result. */
  const echo = (
    inf: InFlight,
  ): {
    extra?: Readonly<Record<string, unknown>>
    updates?: readonly (Readonly<Record<string, unknown>> | ContextUpdater)[]
  } => ({
    ...(inf.effect.extra !== undefined ? { extra: inf.effect.extra } : {}),
    ...(inf.updates?.length ? { updates: inf.updates.slice() } : {}),
  })

  const okResult = (inf: InFlight, value: unknown, async?: true): void => {
    if (inf.settled) return
    const { effectId, hook, token } = inf.effect
    if (hook === 'mapError') {
      const invalid = invalidErrorData(token.step, 'mapError', value)
      if (invalid !== undefined) {
        errResult(inf, invalid, { retryable: false, ...(async ? { async } : {}) })
        return
      }
    }
    const rejected = hook === 'mapError' && retryRejected(opts.def, token.step, value)
    settle(inf, {
      type: 'res.ok',
      effectId,
      hook,
      token,
      value,
      durationMs: opts.clock.now() - inf.startedAt,
      ...(async ? { async } : {}),
      ...(rejected ? { retryable: false as const } : {}),
      ...echo(inf),
    })
  }

  const errResult = (
    inf: InFlight,
    error: unknown,
    flags: {
      timedOut?: true
      cancelled?: true
      syncViolation?: true
      async?: true
      retryable?: false
    } = {},
  ): void => {
    if (inf.settled) return
    const { effectId, hook, token } = inf.effect
    const runFailure = hook === 'run' ? normalizeRunFailure(token.step, error) : undefined
    const invalid = runFailure?.invalid === true
    const reportedError = runFailure === undefined ? error : runFailure.error
    const issues = reportedError instanceof BoundaryRejection ? reportedError.issues : undefined
    const mapsErrors = opts.def.steps[token.step]?.hooks.mapError !== undefined
    const rejected =
      hook === 'run' &&
      !invalid &&
      !mapsErrors &&
      retryRejected(
        opts.def,
        token.step,
        runFailure?.data !== undefined ? runFailure.data : reportedError,
      )
    if (hook === 'run' && mapsErrors && !invalid) {
      rawFailures.set(failureKey(token), {
        step: token.step,
        runId: token.runId,
        attempt: token.attempt,
        error: reportedError,
      })
    }
    settle(inf, {
      type: 'res.err',
      effectId,
      hook,
      token,
      error: {
        ...toSerializedError(reportedError),
        ...(runFailure?.data !== undefined ? { data: runFailure.data } : {}),
      },
      ...(issues !== undefined ? { issues } : {}),
      durationMs: opts.clock.now() - inf.startedAt,
      ...flags,
      ...(rejected || invalid ? { retryable: false as const } : {}),
      ...(runFailure !== undefined
        ? {
            failure: {
              kind: runFailure.kind,
              ...(runFailure.data !== undefined ? { data: runFailure.data } : {}),
            },
          }
        : {}),
      ...echo(inf),
    })
  }

  const armTimeout = (inf: InFlight, ms: number): void => {
    inf.timeout = opts.scheduler.setTimeout(() => {
      inf.timeout = undefined
      if (inf.settled) return
      const error = codedError(
        'TimeoutError',
        'TIMEOUT',
        `hook '${inf.effect.hook}' timed out after ${ms}ms`,
      )
      inf.controller.abort(error)
      errResult(inf, error, { timedOut: true })
    }, ms)
  }

  const armGrace = (inf: InFlight, reason: string | undefined): void => {
    if (inf.grace !== undefined || inf.timeout !== undefined) return
    inf.grace = opts.scheduler.setTimeout(() => {
      inf.grace = undefined
      if (inf.settled) return
      errResult(
        inf,
        codedError('AbortError', 'ABORTED', reason ?? `hook '${inf.effect.hook}' aborted`),
        { cancelled: true, timedOut: true },
      )
    }, graceMs)
  }

  const execute = (effect: CallEffect, causedBy?: number): void => {
    const state = opts.getState()
    const stepDef = opts.def.steps[effect.step]
    const rec = state.steps[effect.step]
    const controller = new AbortController()
    const inf: InFlight = {
      effect,
      controller,
      startedAt: opts.clock.now(),
      causedBy,
      settled: false,
      aborted: false,
      timeout: undefined,
      grace: undefined,
    }
    track(inf)

    // v0.2: the flow-level handler is routed on the hook name alone (`step` is `''`, not a step id).
    const flowLevel = effect.hook === 'flowOn'
    if (stepDef === undefined && !flowLevel) {
      errResult(
        inf,
        new WizardError('UNKNOWN_STEP', `unknown step '${effect.step}'`, { step: effect.step }),
      )
      return
    }
    const event = effect.extra?.event
    if (
      effect.hook === 'on' &&
      typeof event === 'string' &&
      stepDef?.hooks.waitFor?.[event] !== undefined
    ) {
      inf.updates = []
    }

    // `mapError` (v0.2) sees the raw thrown value of the failed attempt when it is still known.
    const key = failureKey(effect.token)
    const raw = effect.hook === 'mapError' ? rawFailures.get(key) : undefined
    const rawError =
      raw !== undefined &&
      raw.runId === effect.token.runId &&
      (raw.attempt === undefined || raw.attempt === effect.token.attempt)
        ? { error: raw.error }
        : {}
    if (raw !== undefined) rawFailures.delete(key)

    const args = buildHookArgs({
      def: opts.def,
      path: opts.path,
      instanceId: opts.instanceId,
      deps: opts.deps,
      state,
      step: effect.step,
      signal: controller.signal,
      update: (patch) => {
        if (inf.updates !== undefined) inf.updates.push(patch)
        else
          opts.send(
            { type: 'context.patch', patch, ...(flowLevel ? {} : { by: effect.step }) },
            causedBy,
          )
      },
      progress: (value) => {
        if (!inf.settled && !flowLevel) opts.progress(effect.step, value)
      },
      extra: { ...effect.extra, ...rawError },
    })

    // The hook call AND the thenable inspection (`then` getter) run under one try:
    // a hostile thenable is a hook failure, never an exception escaping the drain.
    let outcome: unknown
    let then: Then | undefined
    try {
      outcome = flowLevel
        ? invokeFlowOn(opts.def, args)
        : invoke(effect.hook, stepDef as CompiledStep, rec, args)
      then = getThen(outcome)
    } catch (error) {
      errResult(inf, error)
      return
    }

    if (then === undefined) {
      okResult(inf, outcome)
      return
    }

    const pendingUpdates = inf.updates
    inf.updates = undefined
    for (const patch of pendingUpdates ?? []) {
      opts.send({ type: 'context.patch', patch, by: effect.step }, causedBy)
    }

    if (opts.strict === 'sync') {
      const violation = new WizardError(
        'SYNC_VIOLATION',
        `hook '${effect.hook}' of step '${effect.step}' returned a thenable under strict: 'sync'`,
        { step: effect.step },
      )
      controller.abort(violation)
      // Swallow the promise so a later rejection is not "unhandled".
      try {
        then.call(outcome, noop, noop)
      } catch {
        // ignore: the violation below is the only report for this effect
      }
      errResult(inf, violation, { syncViolation: true })
      return
    }

    if (effect.timeoutMs !== undefined && effect.timeoutMs >= 0) armTimeout(inf, effect.timeoutMs)

    try {
      then.call(
        outcome,
        (value: unknown) => okResult(inf, value, true),
        (error: unknown) =>
          errResult(inf, error, inf.aborted ? { cancelled: true, async: true } : { async: true }),
      )
    } catch (error) {
      errResult(inf, error)
    }
  }

  const abort = (step: string, reason?: string): void => {
    abortCalls(byStep.get(step) ?? [], reason, armGrace)
  }

  const abortTransaction = (txId: string, reason?: string): void => {
    abortCalls(
      [...byId.values()].filter((inf) => inf.effect.token.txId === txId),
      reason,
      armGrace,
    )
  }

  const abortUnstarted = (
    effect: CallEffect,
    causedBy: number | undefined,
    reason: string,
  ): void => {
    const inf: InFlight = {
      effect,
      controller: new AbortController(),
      startedAt: opts.clock.now(),
      causedBy,
      settled: false,
      aborted: true,
      timeout: undefined,
      grace: undefined,
    }
    errResult(inf, codedError('AbortError', 'ABORTED', reason), { cancelled: true })
  }

  const abortAll = (reason?: string): void => {
    rawFailures.clear()
    for (const inf of Array.from(byId.values())) {
      inf.settled = true
      inf.aborted = true
      untrack(inf)
      inf.controller.abort(codedError('AbortError', 'ABORTED', reason ?? 'interpreter disposed'))
    }
  }

  return {
    execute,
    abortUnstarted,
    abort,
    abortTransaction,
    abortAll,
    inflight: () => byId.size,
    pending: () => [...byId.values()].filter((call) => !call.controller.signal.aborted).length,
  }
}

function failureKey(token: ResultToken): string {
  return JSON.stringify([
    token.step,
    token.runId,
    token.itemIndex,
    token.itemGeneration,
    token.attempt,
  ])
}
