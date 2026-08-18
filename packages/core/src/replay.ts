/**
 * `replay(flow, events, options)` — rebuild the state of a wizard at any point of its event log
 * by folding the events with the machine's own `apply`. Time travel for devtools, audits and
 * tests: `replay(flow, wizard.log(), { context })` deep-equals `wizard.getState()` for a fresh
 * wizard whose log has not been truncated (`logSize`).
 *
 * Only the wizard's OWN events are folded (`path: []`); a child flow's events (`path: [step,…]`)
 * are skipped — the child's summary rides on the parent's `child.summary` events. `persist.failed`
 * (recorded by the runtime, never applied) is skipped as well.
 *
 * @packageDocumentation
 */

import { compile } from './authoring/compile'
import type { AnyFlow, ContextInput } from './authoring/types'
import { WizardError } from './errors'
import { isThenable } from './interpreter/thenable'
import { apply, initialState } from './machine'
import type { DomainEvent } from './machine/events'
import type { WizardState } from './machine/state'
import type { MachineEnv } from './machine/types'
import type { Snapshot, WizardEvent } from './wizard/create-wizard'

/**
 * `replay` options. Either `context` (the context INPUT the wizard was created with, parsed
 * through the flow's context boundary — the fold starts from the initial state, so the events
 * must begin at `seq` 1) or `from` (a base state — `getState()` captured earlier — the fold
 * starts there and events with `seq <= from.seq` are skipped; a truncated log or a resumed
 * wizard need it). `upTo` stops the fold after that `seq` (inclusive); `instanceId` /
 * `correlationId` seed the initial state (`from` carries its own).
 * @public
 */
export type ReplayOptions<F extends AnyFlow> = {
  readonly upTo?: number
  readonly instanceId?: string
  readonly correlationId?: string
} & (
  | { readonly context: ContextInput<F>; readonly from?: undefined }
  | { readonly from: Snapshot<F>['state']; readonly context?: undefined }
)

/**
 * Fold `events` (a `log()` slice or anything captured with `observe()`, in `seq` order) with the
 * machine's `apply`, from the initial state built from `options.context` (parsed through the
 * flow's context boundary; async boundary → `DEFINITION_INVALID`, rejection →
 * `BOUNDARY_REJECTED`) or from `options.from`, up to `options.upTo` (inclusive). Returns the
 * state at that point — read-only, no hook runs, no effect. Child events (`path` non-empty) and
 * `persist.failed` are skipped. Pure and deterministic: for a fresh wizard whose log was not
 * truncated by `logSize`, `replay(flow, wizard.log(), { context, instanceId: wizard.id })` deep-equals
 * `wizard.getState()`.
 * @public
 */
export function replay<F extends AnyFlow>(
  flow: F,
  events: readonly WizardEvent<F>[],
  options: ReplayOptions<F>,
): Snapshot<F>['state'] {
  const def = compile(flow)
  const env: MachineEnv = {
    def,
    path: [],
    now: () => 0,
    id: (prefix) => `${prefix}:replay`,
  }
  const upTo = options.upTo ?? Number.POSITIVE_INFINITY
  let state: WizardState
  if (options.from !== undefined) {
    state = options.from as unknown as WizardState
  } else {
    const parsed = def.context.parse(options.context)
    if (isThenable(parsed)) {
      throw new WizardError(
        'DEFINITION_INVALID',
        'context boundary must be synchronous for replay (parse the context yourself and pass a base state with `from`)',
      )
    }
    if (!parsed.ok) {
      throw new WizardError(
        'BOUNDARY_REJECTED',
        `context rejected by its boundary: ${parsed.issues.map((i) => i.message).join('; ')}`,
        { issues: parsed.issues },
      )
    }
    const first = events.find((e) => e.path.length === 0)
    state = initialState(env, {
      instanceId: options.instanceId ?? 'replay',
      context: parsed.value,
      now: first?.at ?? 0,
      ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}),
    })
  }
  for (const event of events) {
    // Child events have their own `seq` numbering; `persist.failed` is recorded, never applied.
    if (event.path.length > 0 || event.type === 'persist.failed') continue
    if (event.seq > upTo || event.seq <= state.seq) continue
    state = apply(env, state, event as DomainEvent)
  }
  return state as unknown as Snapshot<F>['state']
}
