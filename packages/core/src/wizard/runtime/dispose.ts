import type { RuntimeContext } from './context'

/** Tear down one runtime and settle every promise owned by its facade. */
export function disposeRuntimeContext(ctx: RuntimeContext): void {
  if (ctx.disposed) return
  ctx.disposed = true
  ctx.commandCommits.clear()
  for (const detach of Array.from(ctx.attached)) {
    try {
      detach()
    } catch (error) {
      ctx.onListenerError(error)
    }
  }
  ctx.attached.clear()
  ctx.driver?.dispose()
  ctx.terminal.dispose()
  for (const step of new Set([
    ...Object.keys(ctx.def.steps),
    ...Object.keys(ctx.interp.childSnapshots()),
  ])) {
    const child = ctx.interp.child(step)
    if (child !== undefined) ctx.disposedChildren.set(step, child)
  }
  ctx.interp.dispose()
  for (const resolve of ctx.pendingMessages.values()) {
    resolve({ batch: [], seq: ctx.interp.getState().seq, disposed: true })
  }
  ctx.pendingMessages.clear()
  ctx.tx.disposeAll()
  for (const settle of Array.from(ctx.pendingOps)) settle()
  ctx.stateListeners.clear()
  ctx.eventListeners.clear()
}
