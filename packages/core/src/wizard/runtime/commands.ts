/**
 * Command plumbing of one runtime: enqueue a command on the interpreter, keep the sync-commit
 * guarantee (plan §8.1 — a synchronous chain yields an already-fulfilled promise), map the
 * processed batch to the public result, and the two doors that run a boundary before enqueuing
 * (`send`: the event boundary; `validate`: the view's input boundary + `validate` hook).
 *
 * @internal
 */

import { describeError, WizardError } from '../../errors'
import { buildHookArgs } from '../../interpreter/hook-args'
import { getThen } from '../../interpreter/thenable'
import type { Command } from '../../machine/commands'
import type { Issue } from '../../machine/state'
import { decodeCommand } from '../parse-command'
import type { CommandResult, NavResult, SendResult } from '../results'
import type { RuntimeContext } from './context'
import {
  commandResult,
  DROPPED_DISPOSED,
  findRejected,
  navToCommandResult,
  ownTxId,
  type Processed,
  rejectedNavResult,
  sendResult,
  sendToCommandResult,
  toNavResult,
} from './results'
import { terminalIn, toOutcome } from './transactions'

type MaybePromise<T> = T | Promise<T>

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
  return getThen(value) !== undefined
}

/** Continue synchronously when possible; otherwise chain. */
function after<T, R>(
  value: MaybePromise<T>,
  fn: (resolved: T) => MaybePromise<R>,
): MaybePromise<R> {
  return isPromiseLike(value) ? value.then(fn) : fn(value)
}

/** A promise that is already fulfilled for sync values (no extra tick). */
function asPromise<T>(value: MaybePromise<T>): Promise<T> {
  return isPromiseLike(value) ? value : Promise.resolve(value)
}

export interface Commands {
  /** Reject on misuse (disposed / thrown), otherwise run — sync work yields an already-fulfilled promise. */
  guarded<T>(fn: () => MaybePromise<T>): Promise<T>
  run(command: Command): Promise<CommandResult>
  nav(command: Command): Promise<NavResult>
  send(event: string, payload: unknown, correlationId: string | undefined): MaybePromise<SendResult>
  validate(step: string): MaybePromise<readonly Issue[]>
  dispatch(input: Command): MaybePromise<CommandResult>
}

export function createCommands(ctx: RuntimeContext): Commands {
  const { def, interp, pendingMessages, pendingOps, tx } = ctx

  /**
   * Enqueue a command. Returns the processed batch synchronously when the interpreter drained it
   * before returning (the common case), otherwise a promise (re-entrant calls made from inside a
   * drain).
   */
  const enqueue = (command: Command): MaybePromise<Processed> => {
    if (ctx.disposed) return { batch: [], seq: interp.getState().seq, disposed: true }
    let sync: Processed | undefined
    let later: ((processed: Processed) => void) | undefined
    pendingMessages.set(command, (processed) => {
      if (later !== undefined) later(processed)
      else sync = processed
    })
    try {
      interp.send(command)
    } catch (error) {
      pendingMessages.delete(command)
      throw error
    }
    if (sync !== undefined) return sync
    return new Promise<Processed>((resolve) => {
      later = resolve
    })
  }

  /**
   * Façade-side async work (a thenable boundary or validate hook) must not outlive the wizard:
   * `dispose()` settles it with `onDisposed()`; the abandoned thenable keeps its handlers so it
   * never rejects unhandled.
   */
  const untilDisposed = <T>(work: Promise<T>, onDisposed: () => T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const settle = (): void => {
        pendingOps.delete(settle)
        try {
          resolve(onDisposed())
        } catch (error) {
          reject(error)
        }
      }
      pendingOps.add(settle)
      work.then(
        (value) => {
          if (pendingOps.delete(settle)) resolve(value)
        },
        (error: unknown) => {
          if (pendingOps.delete(settle)) reject(error)
        },
      )
    })

  /** The `NavResult` of a processed navigation command: settled in its batch, later in the drain, or on dispose. */
  const navResult = (processed: Processed): MaybePromise<NavResult> => {
    if (processed.disposed) {
      return { ok: false, reason: 'failed', code: 'DISPOSED', message: 'wizard disposed' }
    }
    const rejected = findRejected(processed.batch)
    if (rejected !== undefined) return rejectedNavResult(rejected)
    const txId = ownTxId(processed.batch)
    if (txId === undefined) {
      // A pre-flight rejection (nav-busy, not-active, not-a-view, ...) has no `transition.started`;
      // it carries its own (fresh) txId and settles in the same batch.
      const bare = processed.batch.find((event) => event.type === 'transition.rejected')
      if (bare !== undefined) return toNavResult(toOutcome(bare))
      return {
        ok: false,
        reason: 'not-active',
        code: 'INVALID_COMMAND',
        message: 'no transition was started',
      }
    }
    const inBatch = terminalIn(processed.batch, txId)
    if (inBatch !== undefined) return toNavResult(toOutcome(inBatch))
    return after(tx.await(txId), toNavResult)
  }

  const send: Commands['send'] = (event, payload, correlationId) => {
    const boundary = def.events[event]
    if (boundary === undefined) {
      throw new WizardError('UNKNOWN_EVENT', `flow '${def.name}' declares no event '${event}'`)
    }
    const routed = after(boundary.parse(payload), (parsed): MaybePromise<SendResult> => {
      if (ctx.disposed) return DROPPED_DISPOSED
      if (!parsed.ok) {
        const issues = parsed.issues
        return after(
          enqueue({ type: 'sendRejected', event, issues }),
          (): SendResult => ({
            ok: false,
            reason: 'rejected',
            code: 'BOUNDARY_REJECTED',
            message: 'payload rejected by the event boundary',
            issues,
          }),
        )
      }
      return after(
        enqueue({
          type: 'send',
          event,
          payload: parsed.value,
          ...(correlationId !== undefined ? { correlationId } : {}),
        }),
        (processed) => sendResult(event, processed),
      )
    })
    return isPromiseLike(routed) ? untilDisposed(routed, () => DROPPED_DISPOSED) : routed
  }

  const validate: Commands['validate'] = (step) => {
    const stepDef = def.steps[step]
    if (stepDef === undefined) {
      throw new WizardError('UNKNOWN_STEP', `unknown step '${step}'`, { step })
    }
    const state = interp.getState()
    const draft = state.steps[step]?.input
    const controller = new AbortController()
    const runHook = (value: unknown): MaybePromise<readonly Issue[]> => {
      const hook = stepDef.hooks.validate
      if (hook === undefined) return []
      const args = buildHookArgs({
        def,
        path: ctx.init.path,
        instanceId: ctx.instanceId,
        deps: ctx.cfg.deps,
        state,
        step,
        signal: controller.signal,
        update: () => {},
        extra: { input: value },
      })
      const toIssues = (issues: unknown): readonly Issue[] =>
        Array.isArray(issues) ? (issues as readonly Issue[]) : []
      const onError = (error: unknown): readonly Issue[] => [{ message: describeError(error) }]
      try {
        const result = hook(args)
        return isPromiseLike(result) ? result.then(toIssues, onError) : toIssues(result)
      } catch (error) {
        return onError(error)
      }
    }
    const issues =
      stepDef.input === undefined
        ? runHook(draft)
        : after(stepDef.input.parse(draft), (parsed) =>
            parsed.ok ? runHook(parsed.value) : parsed.issues,
          )
    if (!isPromiseLike(issues)) return issues
    return untilDisposed(issues, () => {
      controller.abort(ctx.disposedError())
      throw ctx.disposedError()
    })
  }

  const dispatch: Commands['dispatch'] = (input) => {
    const parsed = decodeCommand(input)
    if (!parsed.ok) {
      return {
        ok: false,
        code: 'INVALID_COMMAND',
        message: 'invalid command shape',
        issues: parsed.issues,
      }
    }
    const command = parsed.value
    switch (command.type) {
      case 'next':
      case 'back':
      case 'go':
        return after(enqueue(command), (processed) =>
          after(navResult(processed), navToCommandResult),
        )
      case 'send':
        // The wire door runs the event boundary too (plan §1.3): a client cannot bypass it.
        if (def.events[command.event] === undefined) {
          return { ok: false, code: 'UNKNOWN_EVENT', message: `unknown event '${command.event}'` }
        }
        return after(
          send(command.event, command.payload, command.correlationId),
          sendToCommandResult,
        )
      default:
        // `child` commands are ordinary commands: the parent machine gates them and plans `child.send`.
        return after(enqueue(command), commandResult)
    }
  }

  return {
    guarded(fn) {
      if (ctx.disposed) return Promise.reject(ctx.disposedError())
      try {
        return asPromise(fn())
      } catch (error) {
        return Promise.reject(error)
      }
    },
    run: (command) => asPromise(after(enqueue(command), commandResult)),
    nav: (command) => asPromise(after(enqueue(command), navResult)),
    send,
    validate,
    dispatch,
  }
}
