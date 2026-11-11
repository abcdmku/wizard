import type { AnyWizard, ContextInput, Run, Snapshot } from '@openwizard/core'
import type { DurableStore, Lease, Version } from '@openwizard/durable/store'
import type { DurableResumeOptions, DurableRunOptions } from './durable-run'
import type { BarrierInput, CommitFailureCode } from './durable-run-state'

interface TimerInput {
  readonly timerId: string
  readonly dueAt: number
  readonly expected: Version
}

type BeforeEffects<F extends AnyWizard> = (input: BarrierInput<F>) => Promise<void>
type BeforeTimer = (timer: TimerInput) => Promise<boolean>

/**
 * `AnyWizard` erases contravariant creator arguments to `never`. The generic helpers retain
 * each wizard's exact context, dependency options and returned Run; only the bound method
 * options are erased here. Calling the wizard keeps dependencies bound by `provide()`.
 */
type BoundCreators<F extends AnyWizard> = {
  create(context: ContextInput<F>, options: object): Run<F>
  resume(snapshot: unknown, options: object): Run<F>
}

export function createCoreRun<F extends AnyWizard>(
  wizard: F,
  options: DurableRunOptions<F>,
  beforeEffects: BeforeEffects<F>,
  beforeTimer: BeforeTimer,
): Run<F> {
  const {
    store: _store,
    key,
    ownerId: _ownerId,
    lease: _lease,
    renew: _renew,
    onLeaseLost: _onLeaseLost,
    redact: _redact,
    context,
    ...core
  } = options
  const bound = wizard as F & BoundCreators<F>
  return bound.create(context, {
    ...core,
    instanceId: core.instanceId ?? key,
    beforeEffects,
    beforeTimer,
  })
}

export function resumeCoreRun<F extends AnyWizard>(
  wizard: F,
  options: DurableResumeOptions<F> | DurableRunOptions<F>,
  snapshot: unknown,
  beforeEffects: BeforeEffects<F>,
  beforeTimer: BeforeTimer,
): Run<F> {
  let resumeOptions:
    | Omit<DurableRunOptions<F>, 'context' | 'instanceId' | 'correlationId'>
    | DurableResumeOptions<F>
  if ('context' in options) {
    const {
      context: _context,
      instanceId: _instanceId,
      correlationId: _correlationId,
      ...shared
    } = options
    resumeOptions = shared
  } else resumeOptions = options
  const {
    store: _store,
    key: _key,
    ownerId: _ownerId,
    lease: _lease,
    renew: _renew,
    onLeaseLost: _onLeaseLost,
    redact: _redact,
    ...core
  } = resumeOptions
  const bound = wizard as F & BoundCreators<F>
  return bound.resume(snapshot, { ...core, beforeEffects, beforeTimer })
}

/** Commit the first snapshot of a new run: `value` is what the store keeps (redacted). */
export async function persistInitialSnapshot<F extends AnyWizard>(
  store: DurableStore,
  lease: Lease,
  snapshot: Snapshot<F>,
  value: unknown,
): Promise<
  | { readonly ok: true; readonly version: Version }
  | { readonly ok: false; readonly code: CommitFailureCode }
> {
  const committed = await store.commit({
    lease,
    expected: null,
    next: { value, version: { epoch: snapshot.epoch, seq: snapshot.seq } },
  })
  if (!committed.ok) return committed
  return committed.version === null
    ? { ok: false, code: 'INVALID_VERSION' }
    : { ok: true, version: committed.version }
}
