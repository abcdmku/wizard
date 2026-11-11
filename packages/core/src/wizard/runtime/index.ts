/**
 * Untyped run runtime — the live object behind the typed `Run<F>` that `wizard.create` and
 * `wizard.resume` return (the internal constructors in `create-wizard` wrap it).
 *
 * Every method is sugar over `dispatch(command)`; results are values:
 * `CommandResult`, `NavResult`, `SendResult`. `WizardError` is the
 * rejection only for misuse: `UNKNOWN_EVENT` (send), `UNKNOWN_STEP` (validate),
 * and `NOT_A_CHILD_STEP` / `NOT_ACTIVE` are thrown by `child()`. After `dispose()`
 * every command resolves a `DISPOSED` value and subscriptions are inert.
 *
 * Sync-commit guarantee: every public call enqueues its command
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
 * including `child` commands (`child.command` → `child.send`) — passes through
 * the interpreter queue.
 *
 * This file is the composition root: `context.ts` (interpreter + shared state),
 * `commands.ts` (enqueue / result plumbing), `transactions.ts` (nav promises),
 * `results.ts` (result mapping), `persistence.ts` (driver + `save`) and
 * `config.ts` (options → config).
 *
 * @internal Public users see the typed `Run<F>`.
 */

import type { CompiledWizard } from '../../authoring/compiled'
import { WizardError } from '../../errors'
import type { ChildFactory } from '../../interpreter/child'
import { eachChildAddress } from '../../interpreter/each-child'
import { explain, progress, readyOrCurrentViews } from '../../machine'
import { createCommands } from './commands'
import { machineEnv, toConfig } from './config'
import { createContext, type RuntimeContext } from './context'
import { disposeRuntimeContext } from './dispose'
import { awaitOutcome, liveWaitingFor, outcomeOf } from './outcome'
import { attachPersistence, save } from './persistence'
import { DISPOSED_COMMAND, DISPOSED_ISSUES, DISPOSED_NAV, DROPPED_DISPOSED } from './results'
import type {
  BuildInit,
  InternalRuntime,
  ResumePlan,
  RuntimeConfig,
  WizardRuntime,
  WizardRuntimeOptions,
} from './types'

/** Subscriptions made after `dispose()` are inert: they never fire and unsubscribe is a no-op. */
const noop = (): void => {}

export { machineEnv, toConfig } from './config'
export type {
  BuildInit,
  DispatchOptions,
  InternalRuntime,
  RestoreChild,
  ResumePlan,
  ResumeWizardRuntimeOptions,
  RuntimeConfig,
  SnapshotMigration,
  WizardRuntime,
  WizardRuntimeOptions,
} from './types'

/** Create a fresh run instance from an already-parsed context. */
export function createWizardRuntime(
  def: CompiledWizard,
  opts: WizardRuntimeOptions,
): WizardRuntime {
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
 * The child factory of one runtime: each child runs with ITS deps (`child(childWizard, { deps })`
 * mapped + parsed by the bridge, or the parent's deps passed through) and inherits the parent's
 * correlation id (same business entity) and is linked to its parent (`ParentLink`);
 * everything else in the config is shared.
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
        { ...cfg, deps: args.deps, parent: args.parent },
        { state, path: args.path, ancestors: args.ancestors, persist: false },
      )
    },
    restore: (args) =>
      cfg.restore(
        args.def,
        args.plan,
        { ...cfg, deps: args.deps, parent: args.parent },
        args.path,
        args.ancestors,
      ),
  }
}

/** Build a runtime around an interpreter (root, resumed root, or child). */
export function buildRuntime(
  def: CompiledWizard,
  cfg: RuntimeConfig,
  init: BuildInit,
): InternalRuntime {
  const ctx = createContext(def, cfg, init, (get) => childFactory(cfg, get))
  const { interp, stateListeners, eventListeners, attached, terminal } = ctx
  const c = createCommands(ctx)
  attachPersistence(ctx)

  let resumePlan: ResumePlan | undefined
  const runtime: InternalRuntime = {
    id: ctx.instanceId,
    path: init.path,
    get epoch() {
      return interp.getState().epoch
    },
    start: () => c.guarded(() => c.run({ type: 'start' }), DISPOSED_COMMAND),
    next: () => c.guarded(() => c.nav({ type: 'next' }), DISPOSED_NAV),
    back: () => c.guarded(() => c.nav({ type: 'back' }), DISPOSED_NAV),
    go: (step) => c.guarded(() => c.nav({ type: 'go', step }), DISPOSED_NAV),
    setInput: (step, patch) =>
      c.guarded(() => c.run({ type: 'setInput', step, patch }), DISPOSED_COMMAND),
    resetInput: (step) => c.guarded(() => c.run({ type: 'resetInput', step }), DISPOSED_COMMAND),
    validate: (step) => c.guarded(() => c.validate(step), DISPOSED_ISSUES),
    send: (event, payload, options) =>
      c.guarded(() => c.send(event, payload, options), DROPPED_DISPOSED),
    startStep: (step) => c.guarded(() => c.run({ type: 'startStep', step }), DISPOSED_COMMAND),
    retry: (step, options) =>
      c.guarded(
        () =>
          c.run(
            options?.patch === undefined
              ? { type: 'retry', step }
              : { type: 'retry', step, patch: options.patch },
          ),
        DISPOSED_COMMAND,
      ),
    cancel: (reason) =>
      c.guarded(
        () => c.run(reason === undefined ? { type: 'cancel' } : { type: 'cancel', reason }),
        DISPOSED_COMMAND,
      ),
    startReady: () => c.guarded(() => c.run({ type: 'startReady' }), DISPOSED_COMMAND),
    compensate: (options) =>
      c.guarded(
        () =>
          c.run({
            type: 'compensate',
            ...(options?.from !== undefined ? { from: options.from } : {}),
            ...(options?.reason !== undefined ? { reason: options.reason } : {}),
          }),
        DISPOSED_COMMAND,
      ),
    reset: () => c.guarded(() => c.run({ type: 'reset' }), DISPOSED_COMMAND),
    skip: (step, reason) =>
      c.guarded(
        () => c.run(reason === undefined ? { type: 'skip', step } : { type: 'skip', step, reason }),
        DISPOSED_COMMAND,
      ),
    invalidate: (step, options) =>
      c.guarded(
        () =>
          c.run({
            type: 'invalidate',
            step,
            ...(options?.cascade !== undefined ? { cascade: options.cascade } : {}),
          }),
        DISPOSED_COMMAND,
      ),
    attach(source) {
      if (ctx.disposed) return noop
      const returned: unknown = source(runtime.send)
      const detach = typeof returned === 'function' ? (returned as () => void) : () => {}
      let detached = false
      const dispose = (): void => {
        if (detached) return
        detached = true
        attached.delete(dispose)
        detach()
      }
      // The source may have disposed the run re-entrantly: then it is let go at once.
      if (ctx.disposed) dispose()
      else attached.add(dispose)
      return dispose
    },
    progress: () => progress(interp.getState(), def),
    readyViews: () => readyOrCurrentViews(def, interp.getState()),
    dispatch: (command, options) => c.guarded(() => c.dispatch(command, options), DISPOSED_COMMAND),
    getState: () => interp.getState(),
    result: () => terminal.current(),
    awaitResult: () => terminal.awaitResult(),
    outcome: () => outcomeOf(ctx),
    awaitOutcome: () => awaitOutcome(ctx, runtime),
    waitingFor: () => liveWaitingFor(ctx),
    whenIdle: () => interp.whenIdle(),
    subscribeResult(listener) {
      if (ctx.disposed) return noop
      return terminal.subscribe(listener)
    },
    getSnapshot: ctx.getSnapshot,
    explain: (step) => ({
      ...explain(def, interp.getState(), step),
      waitingFor: liveWaitingFor(ctx),
    }),
    subscribe(listener) {
      if (ctx.disposed) return noop
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    observe(listener) {
      if (ctx.disposed) return noop
      eventListeners.add(listener)
      return () => {
        eventListeners.delete(listener)
      }
    },
    log: () => interp.log(),
    child(step, keyOrIndex) {
      const stepDef = def.steps[step]
      if (stepDef === undefined || stepDef.kind !== 'child') {
        throw new WizardError('NOT_A_CHILD_STEP', `'${step}' is not a child step`, { step })
      }
      let address = step
      if (stepDef.each !== undefined) {
        const each = interp.getState().steps[step]?.each
        const index =
          typeof keyOrIndex === 'number' ? keyOrIndex : each?.keys.indexOf(keyOrIndex ?? '')
        const key =
          index === undefined || !Number.isSafeInteger(index) || index < 0
            ? undefined
            : each?.keys[index]
        if (key === undefined || index === undefined)
          throw new WizardError(
            'NOT_ACTIVE',
            `mapped child '${step}' requires an active item key or index`,
            { step },
          )
        address = eachChildAddress(step, index, key, def.steps)
      } else if (keyOrIndex !== undefined) {
        throw new WizardError('INVALID_COMMAND', `child '${step}' does not map over items`, {
          step,
        })
      }
      // Disposed runs retain the child handles that were live when they stopped.
      const child = interp.child(address) ?? ctx.disposedChildren.get(address)
      if (child === undefined) {
        throw new WizardError('NOT_ACTIVE', `the child run of '${step}' has not been created yet`, {
          step,
        })
      }
      return child
    },
    save: () => c.guarded(() => save(ctx), undefined),
    dispose() {
      disposeRuntimeContext(ctx)
    },
    isDisposed: () => ctx.disposed,
    prepareResume(plan) {
      resumePlan = plan
      // Restore the full tree first, so the parent's first durable commit includes it.
      interp.restoreChildren(plan.children)
    },
    resumePrepared() {
      const plan = resumePlan
      if (plan === undefined) return
      resumePlan = undefined
      interp.send({ type: 'resume', fromSeq: plan.snapshot.seq })
    },
    resumeFrom(plan) {
      runtime.prepareResume(plan)
      runtime.resumePrepared()
    },
  }

  return runtime
}
