/** Untyped authored fields read by the compiler; constructor signatures validate their shapes. */

import type { RunAdapter } from '../run-adapter'
import type { Boundary } from './boundary'
import type { Duration, JsonValue, RetryPolicy } from './primitives'
import type { Ref } from './step'

export interface StepRecordConfig {
  readonly label?: string
  readonly description?: string
  readonly meta?: Readonly<Record<string, JsonValue>>
  readonly needs?: Readonly<Record<string, unknown>>
  readonly dependsOn?: readonly Ref[] | { readonly any: readonly Ref[] }
  readonly when?: (args: never) => unknown
  readonly enter?: (args: never) => unknown
  readonly exit?: (args: never) => unknown
  readonly next?: Ref | readonly Ref[] | null | ((args: never) => unknown)
  readonly targets?: readonly Ref[]
  readonly on?: Readonly<Record<string, (args: never) => unknown>>
  readonly run?: ((args: never) => unknown) | RunAdapter<never, never, unknown, JsonValue>
  readonly each?: (args: never) => unknown
  readonly key?: (item: never, index: number) => string
  readonly concurrency?: number
  readonly output?: Boundary<unknown, unknown>
  readonly retry?: RetryPolicy<never>
  readonly timeout?: Duration | { readonly after: Duration; readonly next: Ref }
  readonly compensate?: (args: never) => unknown
  readonly idempotencyKey?: boolean | ((args: never) => string)
  readonly mapError?: (error: unknown, args: never) => unknown
  readonly fallback?: Ref
  readonly waitFor?: Readonly<Record<string, (args: never) => unknown>>
  readonly sleep?: Duration | ((args: never) => Duration)
  readonly input?: Boundary<unknown, unknown>
  readonly initial?: unknown
  readonly validate?: (args: never) => unknown
  readonly canEnter?: (args: never) => unknown
  readonly canExit?: (args: never) => unknown
  readonly context?: (args: never) => unknown
  readonly deps?: (args: never) => unknown
}
