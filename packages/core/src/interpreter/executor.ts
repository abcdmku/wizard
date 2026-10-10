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

import type { CompiledFlow, CompiledStep, HookArgs } from '../authoring/compiled'
import { WizardError } from '../errors'
import type { EffectResult, HookName, Message } from '../machine/commands'
import type { CallEffect } from '../machine/effects'
import type { StepRecord, WizardState } from '../machine/state'
import type { Clock, Scheduler } from './env'
import { BoundaryRejection, codedError, toSerializedError, unwrapBoundary } from './errors'
import { buildHookArgs } from './hook-args'
import { chain, getThen, type Then } from './thenable'

export interface ExecutorOptions {
  readonly def: CompiledFlow
  readonly path: readonly string[]
  readonly instanceId: string
  readonly clock: Clock
  readonly scheduler: Scheduler
  readonly deps?: unknown
  readonly strict?: 'sync'
  /**
   * After `abort()`, an unsettled call is reported as
   * `res.err { cancelled: true, timedOut: true }` once this many ms elapse
   * (only when the effect has no `timeoutMs` of its own). Default 30 s.
   */
  readonly abortGraceMs?: number
  getState(): WizardState
  send(msg: Message, causedBy?: number): void
}

export interface Executor {
  /** Run a `call` effect; results come back through `send()` as `res.ok` / `res.err`. */
  execute(effect: CallEffect, causedBy?: number): void
  /** Abort every in-flight call of `step` (cooperative: the hook still settles). */
  abort(step: string, reason?: string): void
  /** Abort everything and silence late results (dispose). */
  abortAll(reason?: string): void
  /** Number of unsettled calls. */
  inflight(): number
}

const DEFAULT_ABORT_GRACE_MS = 30_000

interface InFlight {
  readonly effect: CallEffect
  readonly controller: AbortController
  readonly startedAt: number
  readonly causedBy: number | undefined
  settled: boolean
  aborted: boolean
  timeout: unknown
  grace: unknown
}

/** The raw value a failed `run` threw, kept for the task's `mapError` call (v0.2). */
interface RawFailure {
  readonly step: string
  readonly runId: number
  readonly attempt: number | undefined
  readonly error: unknown
}

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

  /** `extra` is echoed on every result: `on` handling needs `event/payload/inboxId` back. */
  const echo = (inf: InFlight): { extra?: Readonly<Record<string, unknown>> } =>
    inf.effect.extra !== undefined ? { extra: inf.effect.extra } : {}

  const okResult = (inf: InFlight, value: unknown): void => {
    const { effectId, hook, token } = inf.effect
    settle(inf, {
      type: 'res.ok',
      effectId,
      hook,
      token,
      value,
      durationMs: opts.clock.now() - inf.startedAt,
      ...echo(inf),
    })
  }

  const errResult = (
    inf: InFlight,
    error: unknown,
    flags: { timedOut?: true; cancelled?: true; syncViolation?: true } = {},
  ): void => {
    const { effectId, hook, token } = inf.effect
    const issues = error instanceof BoundaryRejection ? error.issues : undefined
    if (hook === 'run' && opts.def.steps[token.step]?.hooks.mapError !== undefined) {
      rawFailures.set(token.step, {
        step: token.step,
        runId: token.runId,
        attempt: token.attempt,
        error,
      })
    }
    settle(inf, {
      type: 'res.err',
      effectId,
      hook,
      token,
      error: toSerializedError(error),
      ...(issues !== undefined ? { issues } : {}),
      durationMs: opts.clock.now() - inf.startedAt,
      ...flags,
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

    // `mapError` (v0.2) sees the raw thrown value of the failed attempt when it is still known.
    const raw = effect.hook === 'mapError' ? rawFailures.get(effect.step) : undefined
    const rawError =
      raw !== undefined &&
      raw.runId === effect.token.runId &&
      (raw.attempt === undefined || raw.attempt === effect.token.attempt)
        ? { error: raw.error }
        : {}
    if (raw !== undefined) rawFailures.delete(effect.step)

    const args = buildHookArgs({
      def: opts.def,
      path: opts.path,
      instanceId: opts.instanceId,
      deps: opts.deps,
      state,
      step: effect.step,
      signal: controller.signal,
      update: (patch) =>
        opts.send(
          { type: 'context.patch', patch, ...(flowLevel ? {} : { by: effect.step }) },
          causedBy,
        ),
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

    if (opts.strict === 'sync') {
      // Swallow the promise so a later rejection is not "unhandled".
      try {
        then.call(outcome, noop, noop)
      } catch {
        // ignore: the violation below is the only report for this effect
      }
      const violation = new WizardError(
        'SYNC_VIOLATION',
        `hook '${effect.hook}' of step '${effect.step}' returned a thenable under strict: 'sync'`,
        { step: effect.step },
      )
      controller.abort(violation)
      errResult(inf, violation, { syncViolation: true })
      return
    }

    if (effect.timeoutMs !== undefined && effect.timeoutMs >= 0) armTimeout(inf, effect.timeoutMs)

    try {
      then.call(
        outcome,
        (value: unknown) => okResult(inf, value),
        (error: unknown) => errResult(inf, error, inf.aborted ? { cancelled: true } : {}),
      )
    } catch (error) {
      errResult(inf, error)
    }
  }

  const abort = (step: string, reason?: string): void => {
    const set = byStep.get(step)
    if (set === undefined) return
    for (const inf of Array.from(set)) {
      if (inf.settled) continue
      inf.aborted = true
      inf.controller.abort(
        codedError('AbortError', 'ABORTED', reason ?? `step '${step}' cancelled`),
      )
      armGrace(inf, reason)
    }
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

  return { execute, abort, abortAll, inflight: () => byId.size }
}

// ---------------------------------------------------------------------------
// Hook invocation
// ---------------------------------------------------------------------------

function invoke(
  hookName: HookName,
  stepDef: CompiledStep,
  rec: StepRecord | undefined,
  args: HookArgs,
): unknown {
  switch (hookName) {
    case 'parseInput': {
      const boundary = stepDef.input
      if (boundary === undefined) return rec?.input
      return chain(boundary.parse(rec?.input), (result) => unwrapBoundary(result, 'input'))
    }
    case 'run': {
      const hook = stepDef.hooks.run
      if (hook === undefined) throw missingHook(stepDef.id, 'run')
      const value = hook(args)
      const boundary = stepDef.output
      if (boundary === undefined) return value
      return chain(value, (v) =>
        chain(boundary.parse(v), (result) => unwrapBoundary(result, 'output')),
      )
    }
    case 'on': {
      const event = typeof args.event === 'string' ? args.event : undefined
      const hook = event === undefined ? undefined : stepDef.hooks.on?.[event]
      if (hook === undefined) throw missingHook(stepDef.id, `on[${String(event)}]`)
      return hook(args)
    }
    case 'flowOn':
      throw missingHook(stepDef.id, 'flowOn')
    case 'childContext': {
      // The child's context is a data door (plan §1.3): the mapped value goes through the
      // child flow's context boundary before `child.create` can see it.
      const hook = stepDef.hooks.childContext
      if (hook === undefined) throw missingHook(stepDef.id, 'childContext')
      const value = hook(args)
      const boundary = stepDef.child?.context
      if (boundary === undefined) return value
      return chain(value, (v) =>
        chain(boundary.parse(v), (result) => unwrapBoundary(result, 'child context')),
      )
    }
    default: {
      const hook = stepDef.hooks[hookName]
      if (hook === undefined) throw missingHook(stepDef.id, hookName)
      return hook(args)
    }
  }
}

/** v0.2: the flow-level `on[extra.event]` handler (`CompiledFlow.on`). */
function invokeFlowOn(def: CompiledFlow, args: HookArgs): unknown {
  const event = typeof args.event === 'string' ? args.event : undefined
  const hook = event === undefined ? undefined : def.on?.[event]
  if (hook === undefined) {
    throw codedError(
      'HookMissingError',
      'HOOK_MISSING',
      `flow '${def.name}' has no 'on[${String(event)}]' handler`,
    )
  }
  return hook(args)
}

function missingHook(step: string, hook: string): Error {
  return codedError('HookMissingError', 'HOOK_MISSING', `step '${step}' has no '${hook}' hook`)
}

function noop(): void {}
