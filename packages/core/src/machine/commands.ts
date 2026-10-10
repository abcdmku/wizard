/**
 * Commands (public, JSON-serializable intents) and internal messages.
 *
 * Every `Wizard` method is sugar over `dispatch(command)`. Transports (Mirror,
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
  /** External event whose payload was ALREADY parsed by the flow's event boundary. */
  | {
      readonly type: 'send'
      readonly event: string
      readonly payload: unknown
      readonly correlationId?: string
    }
  /** External event that FAILED its boundary; recorded for observability. */
  | { readonly type: 'sendRejected'; readonly event: string; readonly issues: readonly Issue[] }
  | { readonly type: 'run'; readonly step: string }
  | { readonly type: 'runReady' }
  | { readonly type: 'retry'; readonly step: string }
  | { readonly type: 'cancel'; readonly reason?: string }
  | { readonly type: 'compensate'; readonly from?: string; readonly reason?: string }
  | { readonly type: 'reset' }
  /** v0.2: skip a ready/active non-final step (`step.skipped { reason: 'command' }`). */
  | { readonly type: 'skip'; readonly step: string; readonly reason?: string }
  /** v0.2: explicit invalidation of a done/failed/skipped step (+ transitive `dependsOn` dependents when `cascade`). */
  | { readonly type: 'invalidate'; readonly step: string; readonly cascade?: boolean }
  /** Address a command to a nested flow. `path` is relative to this wizard (`['fulfil']`, `['fulfil','payment']`). */
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
  readonly txId?: string
}

export type HookName =
  | 'parseInput'
  | 'validate'
  | 'canEnter'
  | 'canExit'
  | 'enter'
  | 'exit'
  | 'run'
  | 'next'
  | 'on'
  | 'compensate'
  | 'childContext'
  | 'childOutput'
  | 'finalOutput'
  /** v0.2: skip predicate (`step.whenStarted` → `res` → `step.whenEvaluated`). */
  | 'when'
  /** v0.2: task failure mapper (`step.mapErrorStarted` → `res` → `step.runFailed { data }`). */
  | 'mapError'
  /** v0.2: custom idempotency key of an idempotent task (`step.idempotencyKeyRequested` → `res` → `step.runStarted`). */
  | 'idempotencyKey'
  /** v0.2: flow-level `on[event]` handler (`event.flowDelivered`); the call's `step` is `''` (no step). */
  | 'flowOn'

export type EffectResult =
  | {
      readonly type: 'res.ok'
      readonly effectId: string
      readonly hook: HookName
      readonly token: ResultToken
      readonly value: unknown
      readonly durationMs: number
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
      readonly timedOut?: boolean
      readonly cancelled?: boolean
      readonly syncViolation?: boolean
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
      readonly failed?: { readonly error: SerializedError }
      readonly phase?: 'compensated'
    }

export interface TimerFired {
  readonly type: 'timer.fired'
  readonly timerId: string
}

/** Internal messages that never cross the wire. */
export type InternalMessage =
  | TimerFired
  /** `update(patch)` called from inside a hook (queued, applied as `context.changed`). */
  | {
      readonly type: 'context.patch'
      readonly patch: Readonly<Record<string, unknown>>
      readonly by?: string
    }
  /** Emitted once by `resumeWizard()` after loading a snapshot (see plan §8.8 recovery matrix). */
  | { readonly type: 'resume'; readonly fromSeq: number }

/** Everything the interpreter queue can carry. */
export type Message = Command | EffectResult | InternalMessage

const INTERNAL_TYPES: ReadonlySet<string> = new Set([
  'res.ok',
  'res.err',
  'res.child',
  'timer.fired',
  'context.patch',
  'resume',
])

export function isCommand(msg: Message): msg is Command {
  return !INTERNAL_TYPES.has(msg.type)
}
