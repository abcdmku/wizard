/**
 * Untyped wizard runtime — the live object behind the typed `Wizard<F>` façade
 * (`createWizard`/`resumeWizard` in the authoring layer wrap it).
 *
 * Every method is sugar over `dispatch(command)`; results are values (plan
 * §8.2): `CommandResult`, `NavResult`, `SendResult`. `WizardError` is the
 * rejection only for misuse: `DISPOSED`, `UNKNOWN_EVENT`, `UNKNOWN_STEP`
 * (validate), and `NOT_A_FLOW_STEP` / `NOT_ACTIVE` are thrown by `child()`.
 *
 * Sync-commit guarantee (plan §8.1): every public call enqueues its command
 * synchronously; when the whole chain (boundary, hooks, machine) is
 * synchronous, the state is committed and listeners are notified before the
 * call returns and the returned promise is *already fulfilled* — no `async`
 * wrappers, no gratuitous microtask hops. Only genuinely asynchronous work
 * (a thenable from a boundary/hook, a transaction waiting for a hook result)
 * yields a pending promise, and every such promise is settled by `dispose()`.
 *
 * Promise settlement: a command's promise resolves when the batch produced by
 * that command commits; navigation commands wait for their transaction
 * (`transition.committed/rejected/failed`; the machine's `settle` effect is
 * honoured as a fallback). Nothing here re-enters the machine: everything —
 * including `child` commands (`child.command` → `child.send`) — flows through
 * the interpreter queue.
 *
 * This file is the composition root: `context.ts` (interpreter + shared state),
 * `commands.ts` (enqueue / result plumbing), `transactions.ts` (nav promises),
 * `results.ts` (result mapping), `persistence.ts` (driver + `save`) and
 * `config.ts` (options → config).
 *
 * @internal Public users see the typed `Wizard<F>`.
 */

import type { CompiledFlow } from '../../authoring/compiled'
import { WizardError } from '../../errors'
import type { ChildFactory } from '../../interpreter/child'
import { explain, progress, readyOrCurrentViews } from '../../machine'
import { createCommands } from './commands'
import { machineEnv, toConfig } from './config'
import { createContext, type RuntimeContext } from './context'
import { attachPersistence, save } from './persistence'
import type {
  BuildInit,
  InternalRuntime,
  ResumePlan,
  RuntimeConfig,
  WizardRuntime,
  WizardRuntimeOptions,
} from './types'

export { machineEnv, toConfig } from './config'
export type {
  BuildInit,
  InternalRuntime,
  RestoreChild,
  ResumePlan,
  ResumeWizardRuntimeOptions,
  RuntimeConfig,
  SnapshotMigration,
  WizardRuntime,
  WizardRuntimeOptions,
} from './types'

/** Create a fresh wizard instance from an already-parsed context. */
export function createWizardRuntime(def: CompiledFlow, opts: WizardRuntimeOptions): WizardRuntime {
  const cfg = toConfig(opts, () => {
    throw new Error('children are only restored on the resume path')
  })
  const instanceId = opts.instanceId ?? cfg.env.ids.id('wiz')
  const state = cfg.initialState(machineEnv(def, [], cfg.env), {
    instanceId,
    context: opts.context,
    now: cfg.env.clock.now(),
    epoch: 0,
    ...(opts.correlationId !== undefined ? { correlationId: opts.correlationId } : {}),
  })
  return buildRuntime(def, cfg, { state, path: [], ancestors: [], persist: true })
}

/**
 * The child factory of one runtime: each child runs with ITS deps (`s.flow(child, { deps })`
 * mapped + parsed by the bridge, or the parent's deps passed through) and inherits the parent's
 * correlation id (v0.2 §9.1 — same business entity); everything else in the config is shared.
 */
function childFactory(
  cfg: RuntimeConfig,
  ctx: () => RuntimeContext,
): ChildFactory<WizardRuntime, ResumePlan> {
  return {
    create: (args) => {
      const correlationId = ctx().interp.getState().correlationId
      const state = cfg.initialState(machineEnv(args.def, args.path, cfg.env), {
        instanceId: cfg.env.ids.id('wiz'),
        context: args.context,
        now: cfg.env.clock.now(),
        epoch: 0,
        ...(correlationId !== undefined ? { correlationId } : {}),
      })
      return buildRuntime(
        args.def,
        { ...cfg, deps: args.deps },
        { state, path: args.path, ancestors: args.ancestors, persist: false },
      )
    },
    restore: (args) =>
      cfg.restore(args.def, args.plan, { ...cfg, deps: args.deps }, args.path, args.ancestors),
  }
}

/** Build a runtime around an interpreter (root, resumed root, or child). */
export function buildRuntime(
  def: CompiledFlow,
  cfg: RuntimeConfig,
  init: BuildInit,
): InternalRuntime {
  const ctx = createContext(def, cfg, init, (get) => childFactory(cfg, get))
  const { interp, stateListeners, eventListeners, attached } = ctx
  const c = createCommands(ctx)
  attachPersistence(ctx)

  const runtime: InternalRuntime = {
    id: ctx.instanceId,
    path: init.path,
    get epoch() {
      return interp.getState().epoch
    },
    start: () => c.guarded(() => c.run({ type: 'start' })),
    next: () => c.guarded(() => c.nav({ type: 'next' })),
    back: () => c.guarded(() => c.nav({ type: 'back' })),
    go: (step) => c.guarded(() => c.nav({ type: 'go', step })),
    setInput: (step, patch) => c.guarded(() => c.run({ type: 'setInput', step, patch })),
    resetInput: (step) => c.guarded(() => c.run({ type: 'resetInput', step })),
    validate: (step) => c.guarded(() => c.validate(step)),
    send: (event, payload, options) =>
      c.guarded(() => c.send(event, payload, options?.correlationId)),
    run: (step) => c.guarded(() => c.run({ type: 'run', step })),
    retry: (step) => c.guarded(() => c.run({ type: 'retry', step })),
    cancel: (reason) =>
      c.guarded(() =>
        c.run(reason === undefined ? { type: 'cancel' } : { type: 'cancel', reason }),
      ),
    runReady: () => c.guarded(() => c.run({ type: 'runReady' })),
    compensate: (options) =>
      c.guarded(() =>
        c.run({
          type: 'compensate',
          ...(options?.from !== undefined ? { from: options.from } : {}),
          ...(options?.reason !== undefined ? { reason: options.reason } : {}),
        }),
      ),
    reset: () => c.guarded(() => c.run({ type: 'reset' })),
    skip: (step, reason) =>
      c.guarded(() =>
        c.run(reason === undefined ? { type: 'skip', step } : { type: 'skip', step, reason }),
      ),
    invalidate: (step, options) =>
      c.guarded(() =>
        c.run({
          type: 'invalidate',
          step,
          ...(options?.cascade !== undefined ? { cascade: options.cascade } : {}),
        }),
      ),
    attach(source) {
      if (ctx.disposed) throw ctx.disposedError()
      const returned: unknown = source(runtime.send)
      const detach = typeof returned === 'function' ? (returned as () => void) : () => {}
      let detached = false
      const dispose = (): void => {
        if (detached) return
        detached = true
        attached.delete(dispose)
        detach()
      }
      // The source may have disposed the wizard re-entrantly: then it is let go at once.
      if (ctx.disposed) dispose()
      else attached.add(dispose)
      return dispose
    },
    progress: () => progress(interp.getState(), def),
    readyViews: () => readyOrCurrentViews(def, interp.getState()),
    dispatch: (command) => c.guarded(() => c.dispatch(command)),
    getState: () => interp.getState(),
    getSnapshot: ctx.getSnapshot,
    explain: (step) => explain(def, interp.getState(), step),
    subscribe(listener) {
      if (ctx.disposed) throw ctx.disposedError()
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    observe(listener) {
      if (ctx.disposed) throw ctx.disposedError()
      eventListeners.add(listener)
      return () => {
        eventListeners.delete(listener)
      }
    },
    log: () => interp.log(),
    child(step) {
      if (ctx.disposed) throw ctx.disposedError()
      const stepDef = def.steps[step]
      if (stepDef === undefined || stepDef.kind !== 'flow') {
        throw new WizardError('NOT_A_FLOW_STEP', `'${step}' is not a flow step`, { step })
      }
      const child = interp.child(step)
      if (child === undefined) {
        throw new WizardError('NOT_ACTIVE', `child flow '${step}' has not been created yet`, {
          step,
        })
      }
      return child
    },
    save: () => c.guarded(() => save(ctx)),
    dispose() {
      if (ctx.disposed) return
      ctx.disposed = true
      // Detach external event sources first so nothing new is sent while tearing down.
      for (const detach of Array.from(attached)) {
        try {
          detach()
        } catch (error) {
          ctx.onListenerError(error)
        }
      }
      attached.clear()
      ctx.driver?.dispose()
      interp.dispose()
      for (const resolve of ctx.pendingMessages.values()) {
        resolve({ batch: [], seq: interp.getState().seq, disposed: true })
      }
      ctx.pendingMessages.clear()
      ctx.tx.disposeAll()
      for (const settle of Array.from(ctx.pendingOps)) settle()
      stateListeners.clear()
      eventListeners.clear()
    },
    isDisposed: () => ctx.disposed,
    resumeFrom(plan) {
      // The machine applies the recovery matrix (and re-creates active flow steps whose child
      // summary was stripped by `prepareResume` because no child snapshot was persisted);
      // children that were persisted are re-attached from their prepared plans, single-pass.
      interp.send({ type: 'resume', fromSeq: plan.snapshot.seq })
      for (const [step, childPlan] of Object.entries(plan.children))
        interp.restoreChild(step, childPlan)
    },
  }

  return runtime
}
