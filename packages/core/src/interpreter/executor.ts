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
 *   `on` resolves `hooks.on[extra.event]`. Every result echoes the effect's
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
import type { Issue, SerializedError, StepRecord, WizardState } from '../machine/state'
import type { Clock, Scheduler } from './env'
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

/** Thrown internally when a boundary rejects a value; carries the issues. */
export class BoundaryRejection extends Error {
  readonly issues: readonly Issue[]
  constructor(issues: readonly Issue[], what: string) {
    super(`${what} rejected by boundary: ${issues.map((i) => i.message).join('; ')}`)
    this.name = 'BoundaryRejection'
    this.issues = issues
  }
}

export function createExecutor(opts: ExecutorOptions): Executor {
  const byId = new Map<string, InFlight>()
  const byStep = new Map<string, Set<InFlight>>()
  const graceMs = opts.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS

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

    if (stepDef === undefined) {
      errResult(
        inf,
        new WizardError('UNKNOWN_STEP', `unknown step '${effect.step}'`, { step: effect.step }),
      )
      return
    }

    const args = buildHookArgs({
      def: opts.def,
      path: opts.path,
      instanceId: opts.instanceId,
      deps: opts.deps,
      state,
      step: effect.step,
      signal: controller.signal,
      update: (patch) => opts.send({ type: 'context.patch', patch, by: effect.step }, causedBy),
      extra: effect.extra,
    })

    // The hook call AND the thenable inspection (`then` getter) run under one try:
    // a hostile thenable is a hook failure, never an exception escaping the drain.
    let outcome: unknown
    let then: Then | undefined
    try {
      outcome = invoke(effect.hook, stepDef, rec, args)
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

function unwrapBoundary(result: unknown, what: string): unknown {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    if (result.ok === true && 'value' in result) return result.value
    if (result.ok === false && 'issues' in result && Array.isArray(result.issues)) {
      throw new BoundaryRejection(result.issues.map(toIssue), what)
    }
  }
  throw codedError(
    'BoundaryError',
    'BOUNDARY_INVALID_RESULT',
    `${what} boundary returned an invalid result`,
  )
}

function toIssue(raw: unknown): Issue {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'message' in raw &&
    typeof raw.message === 'string'
  ) {
    const path = 'path' in raw && Array.isArray(raw.path) ? raw.path : undefined
    return path === undefined ? { message: raw.message } : { message: raw.message, path }
  }
  return { message: String(raw) }
}

function missingHook(step: string, hook: string): Error {
  return codedError('HookMissingError', 'HOOK_MISSING', `step '${step}' has no '${hook}' hook`)
}

function noop(): void {}

// ---------------------------------------------------------------------------
// Hook args
// ---------------------------------------------------------------------------

export interface BuildHookArgsInput {
  readonly def: CompiledFlow
  readonly path: readonly string[]
  readonly instanceId: string
  readonly deps: unknown
  readonly state: WizardState
  readonly step: string
  readonly signal: AbortSignal
  readonly update: (patch: Record<string, unknown>) => void
  readonly extra?: Readonly<Record<string, unknown>> | undefined
}

/** Build the argument object every hook receives (extras override base fields). */
export function buildHookArgs(input: BuildHookArgsInput): HookArgs {
  const rec = input.state.steps[input.step]
  const runId = rec?.runId ?? 0
  const base: HookArgs = {
    step: input.step,
    path: input.path,
    context: input.state.context,
    deps: input.deps,
    input: rec?.input,
    output: rec?.output,
    steps: input.state.steps,
    signal: input.signal,
    attempt: rec?.attempt ?? 0,
    runId,
    idempotencyKey: `${input.instanceId}:${input.step}:${runId}`,
    update: input.update,
  }
  return input.extra === undefined ? base : { ...base, ...input.extra }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Serialize any thrown value into `{ name, message, code? }` — never a stack. */
export function toSerializedError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return code === undefined
      ? { name: error.name, message: error.message }
      : { name: error.name, message: error.message, code }
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String(error.message)
    const name = 'name' in error && typeof error.name === 'string' ? error.name : 'Error'
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return code === undefined ? { name, message } : { name, message, code }
  }
  return { name: 'Error', message: String(error) }
}

function codedError(name: string, code: string, message: string): Error & { code: string } {
  const error = Object.assign(new Error(message), { code })
  error.name = name
  return error
}
