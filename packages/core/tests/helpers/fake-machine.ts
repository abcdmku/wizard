/**
 * Test doubles for the interpreter / façade / persistence suites.
 *
 * - `flow()` / `step()` build `CompiledFlow` literals with sensible defaults.
 * - `initialState` mirrors what the real machine's builder must produce.
 * - `createToyMachine()` is a small but real `Machine` (decide/apply/plan)
 *   covering start, next (with `canExit`), tasks (`run` + timeout), waits
 *   (`on` + timeout timers), inbox buffering, decisions-as-static-next,
 *   flow steps (child bridge), final, cancel, retry, reset, resume and
 *   `context.patch`. Every hook result goes through the real token check.
 *   Tests can override `decide` / `plan` per case to script edge cases.
 *
 * It is deliberately NOT the real machine (that lives in `src/machine/`, built
 * in parallel); it exists so queue semantics can be proven in isolation.
 */

import type {
  BoundaryResult,
  CompiledFlow,
  CompiledStep,
  RuntimeBoundary,
  StepKind,
} from '../../src/authoring/compiled'
import type { Command, Message } from '../../src/machine/commands'
import type { Effect } from '../../src/machine/effects'
import type { DomainEvent, DomainEventBody } from '../../src/machine/events'
import type { StepRecord, WizardState, WizardStatus } from '../../src/machine/state'
import type { InitialState, Machine, MachineEnv } from '../../src/machine/types'

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

export const trusted: RuntimeBoundary = { kind: 'trusted', parse: (value) => ({ ok: true, value }) }

export function boundary(fn: (value: unknown) => BoundaryResult): RuntimeBoundary {
  return { kind: 'parse', parse: fn }
}

/** Accepts objects whose listed keys are strings; rejects everything else with issues. */
export function stringsBoundary(...keys: string[]): RuntimeBoundary {
  return boundary((value) => {
    if (typeof value !== 'object' || value === null)
      return { ok: false, issues: [{ message: 'expected an object' }] }
    const rec = value as Record<string, unknown>
    const issues = keys
      .filter((k) => typeof rec[k] !== 'string')
      .map((k) => ({ message: `${k} must be a string`, path: [k] }))
    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: rec }
  })
}

// ---------------------------------------------------------------------------
// Compiled flow builders
// ---------------------------------------------------------------------------

export type StepSpec = Partial<Omit<CompiledStep, 'id' | 'kind'>> & { readonly kind: StepKind }

export function step(id: string, spec: StepSpec): CompiledStep {
  const { kind, ...rest } = spec
  return {
    id,
    kind,
    next: { kind: 'none' },
    hooks: {},
    expose: { input: kind === 'view', output: false },
    ...rest,
  }
}

export interface FlowSpec {
  readonly name?: string
  readonly version?: number
  readonly steps: Readonly<Record<string, StepSpec>>
  readonly start?: readonly string[]
  readonly events?: Readonly<Record<string, RuntimeBoundary>>
  readonly context?: RuntimeBoundary
  readonly policies?: Partial<CompiledFlow['policies']>
}

export function flow(spec: FlowSpec): CompiledFlow {
  const order = Object.keys(spec.steps)
  const steps: Record<string, CompiledStep> = {}
  for (const id of order) steps[id] = step(id, spec.steps[id]!)
  return {
    name: spec.name ?? 'test-flow',
    version: spec.version ?? 1,
    context: spec.context ?? trusted,
    events: spec.events ?? {},
    steps,
    order,
    start: spec.start ?? [order[0]!],
    policies: {
      onFailure: 'halt',
      autoRun: 'ready',
      concurrency: Number.POSITIVE_INFINITY,
      unmatchedEvents: { buffer: true, ttlMs: 60_000 },
      ...spec.policies,
    },
    identity: {},
  }
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: InitialState = (env, opts) => {
  const steps: Record<string, StepRecord> = {}
  for (const id of env.def.order) {
    steps[id] = {
      id,
      kind: env.def.steps[id]!.kind,
      status: 'idle',
      attempt: 0,
      runId: 0,
      guards: {},
      visitedCount: 0,
      pendingActivation: false,
    }
  }
  return {
    status: 'idle',
    current: null,
    active: [],
    context: opts.context,
    steps,
    history: [],
    nav: { phase: 'idle' },
    saga: { stack: [], compensated: [], failures: [] },
    inbox: [],
    timers: {},
    seq: 0,
    instanceId: opts.instanceId,
    epoch: opts.epoch ?? 0,
    flow: { name: env.def.name, version: env.def.version },
    startedAt: null,
    updatedAt: opts.now,
  }
}

// ---------------------------------------------------------------------------
// Toy machine
// ---------------------------------------------------------------------------

export interface ToyOverrides {
  /** Return `undefined` to fall back to the toy's default decide. */
  readonly decide?: (
    env: MachineEnv,
    state: WizardState,
    msg: Message,
    base: () => readonly DomainEventBody[],
  ) => readonly DomainEventBody[] | undefined
  readonly plan?: (
    env: MachineEnv,
    state: WizardState,
    batch: readonly DomainEvent[],
    base: () => readonly Effect[],
  ) => readonly Effect[] | undefined
  readonly apply?: (
    env: MachineEnv,
    state: WizardState,
    event: DomainEvent,
    base: () => WizardState,
  ) => WizardState | undefined
}

const TERMINAL: ReadonlySet<WizardStatus> = new Set(['done', 'failed', 'cancelled'])

export function createToyMachine(overrides: ToyOverrides = {}): Machine {
  const base: Machine = { decide: toyDecide, apply: toyApply, plan: toyPlan }
  return {
    decide: (env, state, msg) =>
      overrides.decide?.(env, state, msg, () => base.decide(env, state, msg)) ??
      base.decide(env, state, msg),
    apply: (env, state, event) =>
      overrides.apply?.(env, state, event, () => base.apply(env, state, event)) ??
      base.apply(env, state, event),
    plan: (env, state, batch) =>
      overrides.plan?.(env, state, batch, () => base.plan(env, state, batch)) ??
      base.plan(env, state, batch),
  }
}

/** Events that arrive at + enter `id` (and kick off kind-specific work). */
function enterEvents(
  env: MachineEnv,
  state: WizardState,
  id: string,
  from: string | null,
): DomainEventBody[] {
  const rec = state.steps[id]
  const def = env.def.steps[id]
  if (rec === undefined || def === undefined) return []
  const runId = rec.runId + 1
  const out: DomainEventBody[] = [
    { type: 'step.arrived', step: id, from },
    { type: 'step.entered', step: id, from, runId },
  ]
  switch (def.kind) {
    case 'task':
      out.push({
        type: 'step.runStarted',
        step: id,
        attempt: 1,
        runId,
        idempotencyKey: `${state.instanceId}:${id}:${runId}`,
      })
      break
    case 'wait':
      if (def.waitTimeout !== undefined) {
        out.push({
          type: 'timer.scheduled',
          timerId: `wait:${id}`,
          dueAt: env.now() + def.waitTimeout.afterMs,
          purpose: 'waitTimeout',
        })
      }
      break
    case 'flow':
      if (def.hooks.childContext === undefined)
        out.push({ type: 'child.started', step: id, childPath: [...env.path, id] })
      break
    case 'final':
      out.push({ type: 'step.done', step: id }, { type: 'flow.done' })
      break
    default:
      break
  }
  return out
}

/** Static `next` of `id`, or [] . */
function targetsOf(env: MachineEnv, id: string): readonly string[] {
  const next = env.def.steps[id]?.next
  return next?.kind === 'static' ? next.targets : []
}

function advance(env: MachineEnv, state: WizardState, from: string): DomainEventBody[] {
  const out: DomainEventBody[] = []
  for (const target of targetsOf(env, from)) out.push(...enterEvents(env, state, target, from))
  return out
}

function commitTransition(
  env: MachineEnv,
  state: WizardState,
  txId: string,
  from: string,
  cause: 'next' | 'go' | 'back',
): DomainEventBody[] {
  const to = targetsOf(env, from)[0]
  if (to === undefined)
    return [{ type: 'transition.rejected', txId, reason: 'no-target', step: from }]
  return [
    { type: 'step.exited', step: from, to, direction: 'forward' },
    ...enterEvents(env, state, to, from),
    { type: 'transition.committed', txId, from, to, cause, direction: 'forward' },
  ]
}

function toyDecide(env: MachineEnv, S: WizardState, msg: Message): readonly DomainEventBody[] {
  const isCommand = ![
    'res.ok',
    'res.err',
    'res.child',
    'timer.fired',
    'context.patch',
    'resume',
  ].includes(msg.type)
  if (isCommand && TERMINAL.has(S.status) && msg.type !== 'reset') {
    return [
      {
        type: 'command.rejected',
        command: msg as Command,
        reason: 'flow is terminal',
        code: 'FLOW_TERMINAL',
      },
    ]
  }
  switch (msg.type) {
    case 'start': {
      if (S.status !== 'idle') {
        return [
          {
            type: 'command.rejected',
            command: msg,
            reason: 'already started',
            code: 'INVALID_COMMAND',
          },
        ]
      }
      const first = env.def.start[0]!
      const out: DomainEventBody[] = [{ type: 'flow.started', start: first }]
      for (const id of env.def.start) out.push(...enterEvents(env, S, id, null))
      return out
    }
    case 'next': {
      if (S.status === 'idle') {
        return [
          {
            type: 'command.rejected',
            command: msg,
            reason: 'not started',
            code: 'FLOW_NOT_STARTED',
          },
        ]
      }
      // A busy rejection gets a fresh txId so it can never settle the in-flight transaction's promise.
      if (S.nav.phase !== 'idle')
        return [{ type: 'transition.rejected', txId: env.id('tx'), reason: 'nav-busy' }]
      const from = S.current
      if (from === null)
        return [{ type: 'transition.rejected', txId: env.id('tx'), reason: 'not-active' }]
      const txId = env.id('tx')
      const started: DomainEventBody = { type: 'transition.started', txId, from, cause: 'next' }
      if (env.def.steps[from]?.hooks.canExit !== undefined) {
        return [started, { type: 'transition.phase', txId, phase: 'canExit' }]
      }
      return [started, ...commitTransition(env, S, txId, from, 'next')]
    }
    case 'go': {
      const target = S.steps[msg.step]
      if (target === undefined)
        return [
          {
            type: 'command.rejected',
            command: msg,
            reason: `unknown step '${msg.step}'`,
            code: 'UNKNOWN_STEP',
          },
        ]
      if (target.kind !== 'view')
        return [
          { type: 'transition.rejected', txId: env.id('tx'), reason: 'not-a-view', step: msg.step },
        ]
      const txId = env.id('tx')
      const from = S.current
      const out: DomainEventBody[] = [
        { type: 'transition.started', txId, from, to: msg.step, cause: 'go' },
      ]
      if (from !== null)
        out.push({ type: 'step.exited', step: from, to: msg.step, direction: 'forward' })
      out.push(...enterEvents(env, S, msg.step, from))
      out.push({
        type: 'transition.committed',
        txId,
        from,
        to: msg.step,
        cause: 'go',
        direction: 'forward',
      })
      return out
    }
    case 'setInput': {
      const rec = S.steps[msg.step]
      if (rec === undefined || rec.kind !== 'view') {
        return [
          { type: 'command.rejected', command: msg, reason: 'not a view', code: 'NOT_A_VIEW' },
        ]
      }
      return [{ type: 'input.changed', step: msg.step, patch: msg.patch }]
    }
    case 'send': {
      const inboxId = env.id('evt')
      const out: DomainEventBody[] = [
        {
          type: 'event.received',
          event: msg.event,
          payload: msg.payload,
          inboxId,
          ...(msg.correlationId !== undefined ? { correlationId: msg.correlationId } : {}),
        },
      ]
      const targets = S.active.filter(
        (id) =>
          S.steps[id]?.kind === 'wait' && env.def.steps[id]?.hooks.on?.[msg.event] !== undefined,
      )
      if (targets.length > 0) {
        for (const to of targets)
          out.push({ type: 'event.delivered', event: msg.event, to, inboxId })
      } else if (env.def.policies.unmatchedEvents.buffer) {
        const expiresAt = env.now() + env.def.policies.unmatchedEvents.ttlMs
        out.push({ type: 'event.buffered', event: msg.event, inboxId, expiresAt })
        out.push({
          type: 'timer.scheduled',
          timerId: `inbox:${inboxId}`,
          dueAt: expiresAt,
          purpose: 'inboxTtl',
        })
      } else {
        out.push({ type: 'event.dropped', event: msg.event, reason: 'no-listener' })
      }
      return out
    }
    case 'sendRejected':
      return [{ type: 'event.rejected', event: msg.event, issues: msg.issues }]
    case 'retry': {
      const rec = S.steps[msg.step]
      if (rec === undefined || rec.kind !== 'task' || rec.status !== 'failed') {
        return [
          {
            type: 'command.rejected',
            command: msg,
            reason: 'not a failed task',
            code: 'NOT_A_TASK',
          },
        ]
      }
      return [
        {
          type: 'step.runStarted',
          step: msg.step,
          attempt: 1,
          runId: rec.runId,
          idempotencyKey: `${S.instanceId}:${msg.step}:${rec.runId}`,
        },
      ]
    }
    case 'cancel': {
      const out: DomainEventBody[] = S.active.map((id) => ({
        type: 'step.cancelled',
        step: id,
        reason: msg.reason ?? 'cancelled',
      }))
      out.push({
        type: 'flow.cancelled',
        ...(msg.reason !== undefined ? { reason: msg.reason } : {}),
      })
      return out
    }
    case 'reset':
      return [{ type: 'flow.reset' }]
    case 'child': {
      // Parent FIFO route (machine spec §7): accepted child commands become child.command → plan child.send.
      const step = msg.path[0]
      const rec = step === undefined ? undefined : S.steps[step]
      if (rec === undefined || rec.kind !== 'flow') {
        return [
          {
            type: 'command.rejected',
            command: msg,
            reason: 'not-a-flow-step',
            code: 'NOT_A_FLOW_STEP',
          },
        ]
      }
      if (rec.status !== 'active') {
        return [
          {
            type: 'command.rejected',
            command: msg,
            reason: 'child-not-running',
            code: 'NOT_ACTIVE',
          },
        ]
      }
      const command: Command =
        msg.path.length > 1
          ? { type: 'child', path: msg.path.slice(1), command: msg.command }
          : msg.command
      return [{ type: 'child.command', step: step!, command }]
    }
    case 'context.patch':
      return [
        {
          type: 'context.changed',
          patch: msg.patch,
          ...(msg.by !== undefined ? { by: msg.by } : {}),
        },
      ]
    case 'resume':
      return [{ type: 'flow.resumed', fromSeq: msg.fromSeq, interrupted: [] }]
    case 'timer.fired': {
      const out: DomainEventBody[] = [{ type: 'timer.fired', timerId: msg.timerId }]
      if (msg.timerId.startsWith('wait:')) {
        const stepId = msg.timerId.slice(5)
        const rec = S.steps[stepId]
        if (rec?.status === 'active') {
          out.push({ type: 'step.done', step: stepId, output: { event: 'timeout' } })
          const to = env.def.steps[stepId]?.waitTimeout?.next
          if (to !== undefined) out.push(...enterEvents(env, S, to, stepId))
        }
      } else if (msg.timerId.startsWith('inbox:')) {
        const entry = S.inbox.find((e) => `inbox:${e.id}` === msg.timerId)
        if (entry !== undefined)
          out.push({ type: 'event.expired', event: entry.event, inboxId: entry.id })
      }
      return out
    }
    case 'res.child': {
      const out: DomainEventBody[] = [
        { type: 'child.summary', step: msg.step, summary: msg.summary },
      ]
      const rec = S.steps[msg.step]
      if (rec?.status !== 'active') return out
      if (msg.done !== undefined) {
        out.push({ type: 'step.done', step: msg.step, output: msg.done.output })
        out.push(...advance(env, S, msg.step))
      } else if (msg.failed !== undefined) {
        out.push({ type: 'step.failed', step: msg.step, error: msg.failed.error, kind: 'child' })
        out.push({
          type: 'flow.failed',
          step: msg.step,
          error: msg.failed.error,
          code: 'CHILD_FAILED',
        })
      }
      return out
    }
    case 'res.ok':
    case 'res.err': {
      const { token, effectId } = msg
      const rec = S.steps[token.step]
      if (rec === undefined) return [{ type: 'result.ignored', effectId, reason: 'unknown-step' }]
      const stale =
        rec.runId !== token.runId ||
        (token.attempt !== undefined && rec.attempt !== token.attempt) ||
        (token.txId !== undefined && S.nav.txId !== token.txId) ||
        (msg.hook !== 'canExit' && rec.status !== 'active')
      if (stale) return [{ type: 'result.ignored', effectId, reason: 'stale' }]
      const stepId = token.step
      switch (msg.hook) {
        case 'canExit': {
          const txId = S.nav.txId ?? token.txId ?? 'tx?'
          if (msg.type === 'res.err')
            return [{ type: 'transition.failed', txId, step: stepId, error: msg.error }]
          if (msg.value === false) {
            return [
              { type: 'step.guardEvaluated', step: stepId, hook: 'canExit', ok: false },
              { type: 'transition.rejected', txId, reason: 'guard-canExit', step: stepId },
            ]
          }
          return [
            { type: 'step.guardEvaluated', step: stepId, hook: 'canExit', ok: true },
            ...commitTransition(env, S, txId, stepId, 'next'),
          ]
        }
        case 'run': {
          if (msg.type === 'res.ok') {
            return [
              { type: 'step.runSucceeded', step: stepId, attempt: rec.attempt, output: msg.value },
              { type: 'step.done', step: stepId, output: msg.value },
              ...advance(env, S, stepId),
            ]
          }
          const kind = msg.syncViolation ? 'sync-violation' : msg.timedOut ? 'timeout' : 'run'
          return [
            {
              type: 'step.runFailed',
              step: stepId,
              attempt: rec.attempt,
              error: msg.error,
              willRetry: false,
              ...(msg.timedOut ? { timedOut: true } : {}),
            },
            { type: 'step.failed', step: stepId, error: msg.error, kind },
            { type: 'flow.failed', step: stepId, error: msg.error, code: 'STEP_FAILED' },
          ]
        }
        case 'on': {
          if (msg.type === 'res.err') {
            return [
              { type: 'step.failed', step: stepId, error: msg.error, kind: 'hook' },
              { type: 'flow.failed', step: stepId, error: msg.error, code: 'STEP_FAILED' },
            ]
          }
          // OnHandlerResult: `{ keep: true }` stays waiting; `{ done }` is the step output.
          const result = msg.value as { done?: unknown; keep?: true } | undefined
          if (result?.keep === true) return []
          const output = result !== undefined && 'done' in result ? result.done : result
          const out: DomainEventBody[] = [{ type: 'step.done', step: stepId, output }]
          if (S.timers[`wait:${stepId}`] !== undefined)
            out.push({ type: 'timer.cleared', timerId: `wait:${stepId}` })
          out.push(...advance(env, S, stepId))
          return out
        }
        case 'childContext': {
          if (msg.type === 'res.err')
            return [{ type: 'step.failed', step: stepId, error: msg.error, kind: 'hook' }]
          return [{ type: 'child.started', step: stepId, childPath: [...env.path, stepId] }]
        }
        default:
          return []
      }
    }
    default:
      return []
  }
}

function toyApply(env: MachineEnv, S: WizardState, ev: DomainEvent): WizardState {
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

function toyPlan(
  env: MachineEnv,
  S: WizardState,
  batch: readonly DomainEvent[],
): readonly Effect[] {
  const out: Effect[] = []
  const received = new Map<string, unknown>()
  for (const ev of batch) if (ev.type === 'event.received') received.set(ev.inboxId, ev.payload)
  for (const ev of batch) {
    switch (ev.type) {
      case 'step.runStarted': {
        const def = env.def.steps[ev.step]
        out.push({
          kind: 'call',
          effectId: env.id('fx'),
          step: ev.step,
          hook: 'run',
          token: { step: ev.step, runId: ev.runId, attempt: ev.attempt },
          extra: { attempt: ev.attempt },
          ...(def?.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
        })
        break
      }
      case 'transition.phase': {
        if (ev.phase !== 'canExit' || S.nav.from == null) break
        const from = S.nav.from
        out.push({
          kind: 'call',
          effectId: env.id('fx'),
          step: from,
          hook: 'canExit',
          token: { step: from, runId: S.steps[from]!.runId, txId: ev.txId },
          extra: { to: targetsOf(env, from)[0] },
        })
        break
      }
      case 'transition.committed':
        out.push({
          kind: 'settle',
          txId: ev.txId,
          outcome: 'ok',
          value: { from: ev.from, to: ev.to },
        })
        out.push({ kind: 'persist', reason: 'change' })
        break
      case 'transition.rejected':
        out.push({ kind: 'settle', txId: ev.txId, outcome: 'rejected' })
        break
      case 'transition.failed':
        out.push({ kind: 'settle', txId: ev.txId, outcome: 'failed', error: ev.error })
        break
      case 'event.delivered':
        out.push({
          kind: 'call',
          effectId: env.id('fx'),
          step: ev.to,
          hook: 'on',
          token: { step: ev.to, runId: S.steps[ev.to]!.runId },
          extra: { event: ev.event, payload: received.get(ev.inboxId), inboxId: ev.inboxId },
        })
        break
      case 'timer.scheduled':
        out.push({
          kind: 'timer.set',
          timerId: ev.timerId,
          at: ev.dueAt,
          fire: { type: 'timer.fired', timerId: ev.timerId },
        })
        break
      case 'timer.cleared':
        out.push({ kind: 'timer.clear', timerId: ev.timerId })
        break
      case 'step.entered': {
        const def = env.def.steps[ev.step]
        if (def?.kind === 'flow' && def.hooks.childContext !== undefined) {
          out.push({
            kind: 'call',
            effectId: env.id('fx'),
            step: ev.step,
            hook: 'childContext',
            token: { step: ev.step, runId: ev.runId },
          })
        }
        break
      }
      case 'child.started':
        out.push({ kind: 'child.create', step: ev.step, context: S.context })
        break
      case 'child.command':
        out.push({ kind: 'child.send', step: ev.step, command: ev.command })
        break
      case 'flow.done':
        out.push({ kind: 'persist', reason: 'final' })
        break
      case 'flow.reset':
        for (const timerId of Object.keys(S.timers)) out.push({ kind: 'timer.clear', timerId })
        break
      default:
        break
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

/** A ready-to-use env for direct machine calls in tests. */
export function testEnv(
  def: CompiledFlow,
  now = 0,
): MachineEnv & { readonly tick: (ms: number) => void } {
  let t = now
  const counters = new Map<string, number>()
  return {
    def,
    path: [],
    now: () => t,
    id: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1
      counters.set(prefix, n)
      return `${prefix}_${n}`
    },
    tick: (ms) => {
      t += ms
    },
  }
}

export function types(events: readonly DomainEvent[]): string[] {
  return events.map((e) => e.type)
}
