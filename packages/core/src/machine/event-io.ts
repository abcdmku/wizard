/** Data, external-event, timer, child and bookkeeping event bodies. @internal */

import type { Command } from './commands'
import type { ChildSummary, Issue, SerializedError } from './state'

export type IoEventBody =
  // ---- data ----------------------------------------------------------------
  | {
      readonly type: 'input.changed'
      readonly step: string
      readonly patch: unknown
      readonly reset?: boolean
    }
  | { readonly type: 'context.changed'; readonly patch: unknown; readonly by?: string }
  // ---- external events -----------------------------------------------------
  | {
      readonly type: 'event.received'
      readonly event: string
      readonly payload: unknown
      readonly correlationId?: string
      readonly inboxId: string
      /** The delivery's dedupe id (`send(…, { eventId })`), remembered in `state.eventIds`. */
      readonly eventId?: string
    }
  | { readonly type: 'event.rejected'; readonly event: string; readonly issues: readonly Issue[] }
  /** `payload` travels with the delivery so `plan` can build the `on` call from the event alone. */
  | {
      readonly type: 'event.delivered'
      readonly event: string
      readonly to: string
      readonly inboxId: string
      readonly payload?: unknown
    }
  | {
      readonly type: 'event.buffered'
      readonly event: string
      readonly inboxId: string
      readonly expiresAt: number
      readonly payload?: unknown
    }
  | { readonly type: 'event.expired'; readonly event: string; readonly inboxId: string }
  /** `reason`: `'no-listener'`, or `'correlation'` (v0.2: `correlate[event](payload)` â‰  the run's `correlationId`). */
  | { readonly type: 'event.dropped'; readonly event: string; readonly reason: string }
  /** v0.2: delivered to the flow-level `on[event]` handler (`plan` â†’ `call { hook: 'flowOn' }`), after step deliveries. */
  | {
      readonly type: 'event.flowDelivered'
      readonly event: string
      readonly inboxId: string
      readonly payload?: unknown
    }
  /**
   * v0.2: a step handler returned something its kind cannot honour and it was ignored â€” `reason`:
   * `'kind'` (a passive handler returned a result it cannot use; a view returned
   * `keep`/`done`/`fail`) or `'nav-busy'` (a view returned `{ next }` while a transition was in flight).
   */
  | {
      readonly type: 'event.handlerResultIgnored'
      readonly step: string
      readonly event: string
      readonly reason: 'kind' | 'nav-busy'
    }
  /**
   * v0.2: an `on[event]` handler threw. Wait handlers fail their step instead (v0.1 rule); this is
   * recorded for every other kind (`step`) and for the flow-level handler (no `step`); nothing else changes.
   */
  | {
      readonly type: 'event.handlerFailed'
      readonly step?: string
      readonly event: string
      readonly error: SerializedError
    }
  // ---- timers --------------------------------------------------------------
  /** `dueAt` = absolute fire time (`at` is the envelope timestamp). `step` is set for `retry` / `waitTimeout` timers (owner step). */
  | {
      readonly type: 'timer.scheduled'
      readonly timerId: string
      readonly dueAt: number
      readonly purpose: 'retry' | 'waitTimeout' | 'sleep' | 'inboxTtl' | 'compensationGrace'
      readonly step?: string
    }
  | { readonly type: 'timer.fired'; readonly timerId: string }
  | { readonly type: 'timer.cleared'; readonly timerId: string }
  // ---- nested flows --------------------------------------------------------
  /** `childPath` = the child's run path (`[...path, step]`; `path` is the envelope field). `context` = value returned by `childContext` (input for `child.create`). */
  | {
      readonly type: 'child.started'
      readonly step: string
      readonly childPath: readonly string[]
      readonly context?: unknown
    }
  /** `done` mirrors `res.child.done` so `plan` can call `childOutput` / `apply` can store the child output. */
  | {
      readonly type: 'child.summary'
      readonly step: string
      readonly summary: ChildSummary
      readonly done?: { readonly output: unknown }
    }
  /** A `child` command was accepted and must be forwarded to the child interpreter (`plan` â†’ `child.send`). */
  | {
      readonly type: 'child.command'
      readonly step: string
      readonly itemIndex?: number
      readonly command: Command
    }
  // ---- transient (recorded by the runtime, never applied, persisted or logged) -
  /** A hook called `progress(value)`: visible to `observe()`, mirrors and devtools only. */
  | { readonly type: 'step.progress'; readonly step: string; readonly value: unknown }
  // ---- persistence (recorded by the runtime, not decided by the machine) ------
  /**
   * An auto-save or `save()` could not be written: the snapshot is not JSON-serializable
   * (`reason: 'not-serializable'`, `location` = the offending path, e.g.
   * `state.steps.save.output.createdAt`) or the store rejected (`reason: 'store'`). The state
   * itself is unchanged; the envelope `seq` is the seq of the snapshot that failed to persist.
   */
  | {
      readonly type: 'persist.failed'
      readonly reason: 'not-serializable' | 'store'
      readonly key: string
      readonly message: string
      readonly location?: string
    }
  // ---- machine bookkeeping -------------------------------------------------
  | {
      readonly type: 'command.rejected'
      readonly command: Command
      readonly reason: string
      readonly code: string
    }
  | {
      readonly type: 'result.ignored'
      readonly effectId: string
      readonly reason: 'stale' | 'cancelled' | 'unknown-step'
    }
