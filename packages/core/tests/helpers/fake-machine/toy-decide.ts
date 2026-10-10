/** The toy machine's `decide`: commands, hook results, timers, resume (see `index.ts`). */

import type { Command, Message } from '../../../src/machine/commands'
import type { DomainEventBody } from '../../../src/machine/events'
import type { WizardState } from '../../../src/machine/state'
import type { MachineEnv } from '../../../src/machine/types'
import { advance, commitTransition, enterEvents, TERMINAL } from './toy-shared'

export function toyDecide(
  env: MachineEnv,
  S: WizardState,
  msg: Message,
): readonly DomainEventBody[] {
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
