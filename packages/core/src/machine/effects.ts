/**
 * Effects — descriptions of side effects the interpreter must perform.
 * `plan(def, state, event)` returns them; the interpreter executes them and
 * feeds `EffectResult`s back through the queue.
 *
 * Effects are data. The machine never calls a hook, starts a timer or touches
 * a store; that is what keeps `decide/apply/plan` pure and testable.
 */

import type { Command, HookName, ResultToken } from './commands'

export interface CallEffect {
  readonly kind: 'call'
  readonly effectId: string
  readonly step: string
  readonly hook: HookName
  /** Extra, hook-specific arguments merged into the hook's args object (e.g. `{ from }`, `{ to }`, `{ payload, event }`). */
  readonly extra?: Readonly<Record<string, unknown>>
  /** Task timeout in ms (only for `run`). */
  readonly timeoutMs?: number
  readonly token: ResultToken
}

export type Effect =
  | CallEffect
  | {
      readonly kind: 'timer.set'
      readonly timerId: string
      readonly at: number
      readonly fire: Command | { readonly type: 'timer.fired'; readonly timerId: string }
    }
  | { readonly kind: 'timer.clear'; readonly timerId: string }
  | { readonly kind: 'child.create'; readonly step: string; readonly context: unknown }
  | { readonly kind: 'child.send'; readonly step: string; readonly command: Command }
  | { readonly kind: 'child.dispose'; readonly step: string }
  | { readonly kind: 'persist'; readonly reason: 'change' | 'final' | 'manual' }
  /** Resolve the public promise associated with a transaction/command. */
  | {
      readonly kind: 'settle'
      readonly txId: string
      readonly outcome: 'ok' | 'rejected' | 'failed'
      readonly value?: unknown
      readonly error?: unknown
    }

export type EffectKind = Effect['kind']
