/**
 * Child bridge: turns `child.create` / `child.send` / `child.dispose` effects
 * into nested runtimes for `flow` steps.
 *
 * - The nested runtime is created by an injected factory (the run façade
 *   supplies `createWizardRuntime` / `resumeWizardRuntime`) so this module has
 *   no runtime dependency on the façade.
 * - Child events are forwarded to the parent's `observe()` stream unchanged
 *   (they carry their own `path` + `seq`); on every child commit the bridge
 *   sends `res.child { step, token, summary, done?, failed?, phase? }` to the
 *   parent queue — `token` = the parent flow step's `{ step, runId }` at
 *   creation/restore, `done` / `failed` only on the transition into that
 *   status, `phase: 'compensated'` once the child finished its own
 *   compensation (`flow.compensated` / `flow.cancelled`).
 * - Guards: `maxDepth` (default 8) and embedding an ancestor flow → the flow
 *   step fails (`res.child { failed }` with code `NESTING_TOO_DEEP` /
 *   `NESTING_CYCLE`); the compile step catches the cycle statically as well.
 * - Tree turn: each child gets a `ParentLink`; its hook calls wait while an ancestor has
 *   messages queued, and a child that stops while attached (a fatal error, a direct
 *   `dispose()`) fails the flow step (`res.child { failed }`) instead of leaving it active.
 * - Deps: at creation (and restore) the flow step's RAW `deps` mapper
 *   (`hooks.childDeps`) is evaluated once and its value parsed ONCE through the
 *   child flow's `deps` boundary (when it declares one); without a mapper the
 *   parent's deps object is passed through unchanged. A throwing mapper, a
 *   rejecting or asynchronous boundary fails the flow step (`res.child { failed }`).
 *
 * @internal
 */

import type { CompiledFlow } from '../authoring/compiled'
import type { Message, ResultToken } from '../machine/commands'
import type { RunStatus, SerializedError, WizardState } from '../machine/state'
import { samePath, setOwn } from '../machine/util'
import type { Snapshot } from '../wizard/snapshot'
import { resolveDeps } from './child-deps'
import { childFailure, summarize } from './child-summary'
import type { ChildBridge, ChildBridgeOptions, ChildHandle, ParentLink } from './child-types'
import { toSerializedError } from './errors'
import { noop } from './executor-invoke'

/**
 * `plan` is whatever the factory prepared for this child ahead of time (the
 * façade passes its validated, boundary-checked `ResumePlan`; tests may pass a
 * raw `Snapshot`). The bridge never looks inside it.
 */
export type {
  ChildBridge,
  ChildBridgeOptions,
  ChildCreateArgs,
  ChildFactory,
  ChildHandle,
  ChildRestoreArgs,
  ParentLink,
} from './child-types'

const DEFAULT_MAX_DEPTH = 8

interface Attached<H extends ChildHandle> {
  readonly handle: H
  /** Parent flow step token at creation/restore (echoed on every res.child). */
  readonly token: ResultToken
  unobserve: () => void
  unsubscribe: () => void
  lastStatus: RunStatus | undefined
  pendingPhase: 'compensated' | undefined
}

export function createChildBridge<H extends ChildHandle, P = Snapshot>(
  opts: ChildBridgeOptions<H, P>,
): ChildBridge<H, P> {
  const children = new Map<string, Attached<H>>()
  const restored = new Set<Attached<H>>()
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  /** > 0 while the parent drives a child synchronously (create / restore / send). */
  let driving = 0
  const drive = (fn: () => void): void => {
    driving += 1
    try {
      fn()
    } finally {
      driving -= 1
    }
  }

  /** Token of the parent flow step at creation/restore time: `{ step, runId }`. */
  const tokenFor = (step: string): ResultToken =>
    opts.tokenFor?.(step) ?? {
      step,
      runId: opts.getState().steps[step]?.runId ?? 0,
    }

  /** Fail the flow step; `lost` = the attached child that stopped (its token, past its last summary). */
  const fail = (
    step: string,
    error: SerializedError,
    causedBy?: number,
    lost?: Attached<H>,
  ): void => {
    const known = opts.getState().steps[step]?.child?.seq ?? 0
    const reported = lost === undefined ? 0 : lost.handle.getState().seq
    opts.send(
      {
        type: 'res.child',
        step,
        token: lost?.token ?? tokenFor(step),
        summary: {
          status: 'failed',
          current: null,
          progress: 0,
          seq: Math.max(known, reported) + 1,
        },
        failed: { error },
      },
      causedBy,
    )
  }

  const childDefOf = (step: string): CompiledFlow | undefined => opts.def.steps[step]?.child

  const notify = (step: string, entry: Attached<H>, state: WizardState): void => {
    const childDef = childDefOf(step)
    if (childDef === undefined) return
    const summary = summarize(state, childDef)
    const entered = entry.lastStatus !== state.status
    entry.lastStatus = state.status
    const phase = entry.pendingPhase
    entry.pendingPhase = undefined
    const owner = opts.def.steps[step]
    const failed =
      entered &&
      (state.status !== 'halted' || owner?.fallback !== undefined || owner?.each !== undefined)
        ? childFailure(state)
        : undefined
    const msg: Extract<Message, { type: 'res.child' }> = {
      type: 'res.child',
      step,
      token: entry.token,
      summary,
      ...(entered && state.status === 'done' ? { done: { output: state.output } } : {}),
      ...(failed !== undefined ? { failed } : {}),
      ...(phase !== undefined ? { phase } : {}),
      // A commit the parent did not drive (an async child hook settled) is a hop boundary.
      ...(driving === 0 ? { async: true as const } : {}),
    }
    opts.send(msg)
  }

  const detach = (entry: Attached<H>): void => {
    restored.delete(entry)
    entry.unobserve()
    entry.unsubscribe()
    entry.handle.dispose()
  }

  /** A child that stopped while still attached fails its flow step (the step never hangs). */
  const lose = (step: string, entry: Attached<H>, error: unknown): void => {
    if (children.get(step) !== entry) return
    children.delete(step)
    detach(entry)
    const name = entry.handle.getState().flow.name
    const reason: SerializedError =
      error === undefined
        ? {
            name: 'ChildFlowDisposed',
            message: `child flow '${name}' was disposed`,
            code: 'CHILD_DISPOSED',
          }
        : toSerializedError(error)
    fail(step, reason, undefined, entry)
  }

  /** The link a child is built with; a stop reported before `attach` (a fatal resume) waits for it. */
  const linkFor = (step: string) => {
    const slot: { entry?: Attached<H>; early?: { readonly error: unknown } } = {}
    const link: ParentLink = {
      busy: opts.turn.busy,
      // A resumed drain is still parent-driven: its commits are no async hop boundary.
      defer: (resume) => opts.turn.defer(() => drive(resume)),
      stopped: (error) => {
        if (slot.entry === undefined) slot.early ??= { error }
        else lose(step, slot.entry, error)
      },
    }
    /** Bind the attached entry; false when the child already stopped (the step is failed). */
    const bind = (entry: Attached<H>): boolean => {
      slot.entry = entry
      if (slot.early === undefined) return true
      lose(step, entry, slot.early.error)
      return false
    }
    return { link, bind }
  }

  const attach = (step: string, handle: H, lastStatus: RunStatus | undefined): Attached<H> => {
    const existing = children.get(step)
    if (existing !== undefined) {
      children.delete(step)
      detach(existing)
    }
    const entry: Attached<H> = {
      handle,
      token: tokenFor(step),
      unobserve: noop,
      unsubscribe: noop,
      lastStatus,
      pendingPhase: undefined,
    }
    children.set(step, entry)
    const childPath = [...opts.path, step]
    entry.unobserve = handle.observe((event) => {
      // The child finished its own compensation (or was cancelled by the parent's compensate):
      // the next summary carries `phase: 'compensated'` so the parent's unwind can continue.
      if (
        (event.type === 'flow.compensated' || event.type === 'flow.cancelled') &&
        samePath(event.path, childPath)
      ) {
        entry.pendingPhase = 'compensated'
      }
      opts.forward(event)
    })
    entry.unsubscribe = handle.subscribe((state) => notify(step, entry, state))
    return entry
  }

  const childDeps = (step: string, childDef: CompiledFlow, causedBy: number | undefined) =>
    resolveDeps({
      step,
      mapper: opts.def.steps[step]?.hooks.childDeps,
      childDef,
      parentDeps: opts.deps,
      parentDeclaresDeps: opts.def.deps !== undefined,
      args: () => opts.hookArgs(step, causedBy),
    })

  const create: ChildBridge<H, P>['create'] = (step, context, causedBy) => {
    const childDef = childDefOf(step)
    if (childDef === undefined) {
      fail(
        step,
        {
          name: 'WizardError',
          code: 'NOT_A_FLOW_STEP',
          message: `step '${step}' has no child flow`,
        },
        causedBy,
      )
      return
    }
    if (opts.path.length + 1 > maxDepth) {
      fail(
        step,
        {
          name: 'WizardError',
          code: 'NESTING_TOO_DEEP',
          message: `nesting deeper than ${maxDepth} at '${step}'`,
        },
        causedBy,
      )
      return
    }
    const ancestors = [...opts.ancestors, opts.def.identity]
    if (ancestors.includes(childDef.identity)) {
      fail(
        step,
        {
          name: 'WizardError',
          code: 'NESTING_CYCLE',
          message: `flow '${childDef.name}' embeds one of its ancestors`,
        },
        causedBy,
      )
      return
    }
    const deps = childDeps(step, childDef, causedBy)
    if (!deps.ok) {
      fail(step, deps.error, causedBy)
      return
    }
    const { link, bind } = linkFor(step)
    const handle = opts.factory.create({
      step,
      def: childDef,
      context,
      deps: deps.value,
      path: [...opts.path, step],
      ancestors,
      parent: link,
    })
    if (bind(attach(step, handle, undefined)))
      void handle.dispatch({ type: 'start' }).then(noop, noop)
  }

  const restore: ChildBridge<H, P>['restore'] = (step, plan) => {
    const childDef = childDefOf(step)
    if (childDef === undefined) return
    const deps = childDeps(step, childDef, undefined)
    if (!deps.ok) {
      fail(step, deps.error)
      return
    }
    const { link, bind } = linkFor(step)
    const handle = opts.factory.restore({
      step,
      def: childDef,
      plan,
      deps: deps.value,
      path: [...opts.path, step],
      ancestors: [...opts.ancestors, opts.def.identity],
      parent: link,
    })
    const known = opts.getState().steps[step]?.child?.status
    const entry = attach(step, handle, known)
    if (bind(entry)) {
      if (handle.resumePrepared === undefined) notify(step, entry, handle.getState())
      else restored.add(entry)
    }
  }

  return {
    create: (step, context, causedBy) => drive(() => create(step, context, causedBy)),
    restore: (step, plan) => drive(() => restore(step, plan)),
    resumeRestored() {
      for (const entry of Array.from(restored)) {
        restored.delete(entry)
        drive(() => entry.handle.resumePrepared?.())
      }
    },
    send(step, command) {
      const entry = children.get(step)
      if (entry === undefined) return
      drive(() => void entry.handle.dispatch(command).then(noop, noop))
    },

    dispose(step) {
      const entry = children.get(step)
      if (entry === undefined) return
      children.delete(step)
      detach(entry)
    },

    disposeAll() {
      for (const [step, entry] of Array.from(children.entries())) {
        children.delete(step)
        detach(entry)
      }
    },

    get: (step) => children.get(step)?.handle,
    has: (step) => children.has(step),

    snapshots() {
      // A plain object (it round-trips through JSON unchanged); `setOwn` keeps `__proto__` an own key.
      const out: Record<string, Snapshot> = {}
      for (const [step, entry] of children) setOwn(out, step, entry.handle.getSnapshot())
      return out
    },
  }
}
