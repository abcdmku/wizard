/**
 * Commands (public, JSON-serializable intents) and internal messages.
 *
 * Every `FlowRun` method is sugar over `dispatch(command)`. Transports (Mirror,
 * HTTP, WebSocket) carry `Command` objects; the machine (`decide`) validates
 * them and turns them into events. Internal messages (`EffectResult`,
 * `TimerFired`) never cross the wire.
 */

import type { ChildSummary, Issue, SerializedError } from './state'

// ---------------------------------------------------------------------------
// Public commands
// ---------------------------------------------------------------------------

export type Command =
  | { readonly type: 'start' }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'go'; readonly step: string; readonly reason?: string }
  | { readonly type: 'setInput'; readonly step: string; readonly patch: unknown }
  | { readonly type: 'resetInput'; readonly step: string }
  /**
   * External event whose payload was ALREADY parsed by the flow's event boundary. `eventId`
   * dedupes deliveries (D8): an id the run still remembers is a duplicate and changes nothing.
   */
  | {
      readonly type: 'send'
      readonly event: string
      readonly payload: unknown
      readonly correlationId?: string
      readonly eventId?: string
    }
  /** External event that FAILED its boundary; recorded for observability. */
  | { readonly type: 'sendRejected'; readonly event: string; readonly issues: readonly Issue[] }
  | { readonly type: 'startStep'; readonly step: string }
  | { readonly type: 'startReady' }
  /** Re-run a failed runnable step; `patch` is merged into the context first (D12). */
  | {
      readonly type: 'retry'
      readonly step: string
      readonly patch?: Readonly<Record<string, unknown>>
    }
  | { readonly type: 'cancel'; readonly reason?: string }
  | { readonly type: 'compensate'; readonly from?: string; readonly reason?: string }
  | { readonly type: 'reset' }
  /** Skip a ready or active step that does not complete the flow. */
  | { readonly type: 'skip'; readonly step: string; readonly reason?: string }
  /** Explicit invalidation of a done/failed/skipped step (+ transitive `needs` dependents when `cascade`). */
  | { readonly type: 'invalidate'; readonly step: string; readonly cascade?: boolean }
  /** Address a command to a nested flow. `path` is relative to this run (`['fulfil']`, `['fulfil','payment']`). */
  | { readonly type: 'child'; readonly path: readonly string[]; readonly command: Command }

export type CommandType = Command['type']

// ---------------------------------------------------------------------------
// Internal messages
// ---------------------------------------------------------------------------

/** Stale-result detection: results are ignored when tokens no longer match state. */
export interface ResultToken {
  readonly step: string
  readonly runId: number
  readonly attempt?: number
  /** Map item index, independent of the enclosing step's attempt. */
  readonly itemIndex?: number
  /** Manual retry generation of one map item. */
  readonly itemGeneration?: number
  readonly txId?: string
  /** Sequence of the event that requested a dynamic view initializer. */
  readonly initialSeq?: number
  /**
   * Handler calls (`on` / `flowOn`) for the event a `send` delivered: the failed-step count once
   * that send was decided. The call is dropped unstarted if the delivery stopped since
   * (`deliveryCallStopped`, R6 atomic delivery).
   */
  readonly failedAtDelivery?: number
}

export type HookName =
  | 'parseInput'
  | 'validate'
  | 'canEnter'
  | 'canExit'
  | 'initial'
  | 'enter'
  | 'exit'
  | 'run'
  | 'next'
  | 'on'
  | 'compensate'
  | 'childContext'
  | 'childOutput'
  | 'each'
  | 'sleep'
  /** Skip predicate (`step.whenStarted` → `res` → `step.whenEvaluated`). */
  | 'when'
  /** Run failure mapper (`step.mapErrorStarted` → `res` → `step.runFailed { data }`). */
  | 'mapError'
  /** Custom idempotency key of an idempotent run. */
  | 'idempotencyKey'
  /** Flow-level `on[event]` handler (`event.flowDelivered`); the call's `step` is `''` (no step). */
  | 'flowOn'

export type TaskFailureKind = 'typed' | 'defect' | 'interrupted'

export type EffectResult =
  | {
      readonly type: 'res.ok'
      readonly effectId: string
      readonly hook: HookName
      readonly token: ResultToken
      readonly value: unknown
      readonly durationMs: number
      readonly updates?: readonly (Readonly<Record<string, unknown>> | ContextUpdater)[]
      /** The hook settled asynchronously: an async boundary resets the auto-advance hop guard. */
      readonly async?: true
      /** `mapError` results: the step's `retry.when` rejected the mapped error (no retry). */
      readonly retryable?: false
      /** Echo of the planned `CallEffect.extra` (the interpreter MUST copy it back; `on` results need `event/payload/inboxId`). */
      readonly extra?: Readonly<Record<string, unknown>>
    }
  | {
      readonly type: 'res.err'
      readonly effectId: string
      readonly hook: HookName
      readonly token: ResultToken
      readonly error: SerializedError
      readonly issues?: readonly Issue[]
      readonly durationMs: number
      readonly updates?: readonly (Readonly<Record<string, unknown>> | ContextUpdater)[]
      /** See `res.ok.async`. */
      readonly async?: true
      readonly timedOut?: boolean
      readonly cancelled?: boolean
      readonly syncViolation?: boolean
      /** `run` results of a step without `mapError`: its `retry.when` rejected the error. */
      readonly retryable?: false
      /** Optional failure classification supplied by a runtime-neutral run adapter. */
      readonly failure?: {
        readonly kind: TaskFailureKind
        /** Present only after the adapter validated its durable error value. */
        readonly data?: unknown
      }
      /** Echo of the planned `CallEffect.extra` (see `res.ok`). */
      readonly extra?: Readonly<Record<string, unknown>>
    }
  /**
   * A child flow's public state changed (summary + full snapshot for persistence).
   * `token` = `{ step, runId }` of the parent flow step when the child was created
   * (the child bridge echoes it; stale/foreign results are ignored). `summary.seq`
   * must increase between messages. `phase: 'compensated'` = the child finished
   * its own compensation (completes the parent's `compensate` of that step).
   */
  | {
      readonly type: 'res.child'
      readonly step: string
      readonly token: ResultToken
      readonly summary: ChildSummary
      readonly done?: { readonly output: unknown }
      /**
       * The child ended failed or cancelled. `data` = the child's mapped error data (kept on the
       * parent step's error); `route` = the step the flow step's `fallback` chose instead of failing.
       */
      readonly failed?: {
        readonly error: SerializedError
        readonly data?: unknown
        readonly route?: string
      }
      readonly phase?: 'compensated'
      /** The child committed outside the parent's synchronous dispatch: an async hop boundary. */
      readonly async?: true
    }

export interface TimerFired {
  readonly type: 'timer.fired'
  readonly timerId: string
}

/** Internal messages that never cross the wire. */
export type InternalMessage =
  | TimerFired
  | { readonly type: 'settle' }
  /**
   * `update(patch | fn)` called from inside a hook (queued, applied as `context.changed`). A
   * function patch is applied to the latest committed context when the message is decided.
   */
  | {
      readonly type: 'context.patch'
      readonly patch: Readonly<Record<string, unknown>> | ContextUpdater
      readonly by?: string
    }
  /** Emitted once by `wizard.resume()` after loading a snapshot (see plan §8.8 recovery matrix). */
  | { readonly type: 'resume'; readonly fromSeq: number }

/** `update(fn)`: the patch computed from the current context (`undefined` = no change). */
export type ContextUpdater = (current: unknown) => unknown

/** Everything the interpreter queue can carry. */
export type Message = Command | EffectResult | InternalMessage

const INTERNAL_TYPES: ReadonlySet<string> = new Set([
  'res.ok',
  'res.err',
  'res.child',
  'timer.fired',
  'context.patch',
  'resume',
  'settle',
])

export function isCommand(msg: Message): msg is Command {
  return !INTERNAL_TYPES.has(msg.type)
}
