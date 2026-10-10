/**
 * Persistence of a root runtime: the auto-save driver (created only for a persisting root with a
 * store) and `save()`; every write failure is recorded as `persist.failed` before it is handed on.
 *
 * @internal
 */

import { createPersistenceDriver } from '../../persistence/driver'
import { canReviveAt } from '../../persistence/revivable'
import type { RuntimeContext } from './context'

/** Wire the driver into `ctx.driver` (a no-op for children and for runtimes without a store). */
export function attachPersistence(ctx: RuntimeContext): void {
  const p = ctx.cfg.persistence
  if (!ctx.init.persist || p === undefined) return
  const key = p.key ?? ctx.instanceId
  const onError =
    p.onError ??
    ((error: unknown) => {
      queueMicrotask(() => {
        throw error
      })
    })
  ctx.driver = createPersistenceDriver({
    store: p.store,
    key,
    autoSave: p.autoSave,
    debounceMs: p.debounceMs,
    scheduler: ctx.cfg.env.scheduler,
    getSnapshot: () => ctx.getSnapshot(),
    redact: p.redact,
    clearOnDone: p.clearOnDone,
    onError: (error) => {
      ctx.reportPersistFailure(key, error)
      onError(error)
    },
    reviveAt: (path, value) => canReviveAt(ctx.def, value, path),
  })
}

/** Write a snapshot now (resolves at once without a store); a failure is recorded, then rethrown. */
export function save(ctx: RuntimeContext): Promise<void> | undefined {
  const driver = ctx.driver
  if (driver === undefined) return undefined
  return driver.save().then(undefined, (error: unknown) => {
    ctx.reportPersistFailure(ctx.cfg.persistence?.key ?? ctx.instanceId, error)
    throw error
  })
}
