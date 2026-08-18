/**
 * Child bridge: turns `child.create` / `child.send` / `child.dispose` effects
 * into nested runtimes for `flow` steps.
 *
 * - The nested runtime is created by an injected factory (the wizard façade
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
 * - Deps: at creation (and restore) the flow step's RAW `deps` mapper
 *   (`hooks.childDeps`) is evaluated once and its value parsed ONCE through the
 *   child flow's `deps` boundary (when it declares one); without a mapper the
 *   parent's deps object is passed through unchanged. A throwing mapper, a
 *   rejecting or asynchronous boundary fails the flow step (`res.child { failed }`).
 *
 * @internal
 */

import type { CompiledFlow, HookArgs } from '../authoring/compiled'
import type { Command, Message, ResultToken } from '../machine/commands'
import type { DomainEvent } from '../machine/events'
import { progress } from '../machine/selectors'
import type { ChildSummary, SerializedError, WizardState, WizardStatus } from '../machine/state'
import type { Snapshot } from '../wizard/snapshot'

/** What the bridge needs from a nested runtime (`WizardRuntime` satisfies it). */
export interface ChildHandle {
  getState(): WizardState
  getSnapshot(): Snapshot
  dispatch(command: Command): Promise<unknown>
  subscribe(listener: (state: WizardState) => void): () => void
  observe(listener: (event: DomainEvent) => void): () => void
  dispose(): void
}

export interface ChildCreateArgs {
  readonly step: string
  readonly def: CompiledFlow
  /** Child context INPUT (already parsed by the child's context boundary in the executor). */
  readonly context: unknown
  /** The child's deps: mapped + parsed through the child's deps boundary, or the parent's deps. */
  readonly deps: unknown
  readonly path: readonly string[]
  /** Identities of every enclosing flow (nearest last). */
  readonly ancestors: readonly object[]
}

/**
 * `plan` is whatever the factory prepared for this child ahead of time (the
 * façade passes its validated, boundary-checked `ResumePlan`; tests may pass a
 * raw `Snapshot`). The bridge never looks inside it.
 */
export interface ChildRestoreArgs<P> {
  readonly step: string
  readonly def: CompiledFlow
  readonly plan: P
  /** Same rule as `ChildCreateArgs.deps` (mappers re-run on restore; deps are never persisted). */
  readonly deps: unknown
  readonly path: readonly string[]
  readonly ancestors: readonly object[]
}

export interface ChildFactory<H extends ChildHandle, P = Snapshot> {
  create(args: ChildCreateArgs): H
  restore(args: ChildRestoreArgs<P>): H
}

export interface ChildBridgeOptions<H extends ChildHandle, P = Snapshot> {
  readonly def: CompiledFlow
  readonly path: readonly string[]
  readonly ancestors: readonly object[]
  readonly factory: ChildFactory<H, P>
  /** Maximum nesting depth (path length of the deepest child). Default 8. */
  readonly maxDepth?: number
  /** The parent's deps (passed through unchanged when a flow step has no `deps` mapper). */
  readonly deps?: unknown
  /** Build the hook args a flow step's `deps` mapper receives (context, parent deps, `update`, …). */
  hookArgs(step: string, causedBy?: number): HookArgs
  getState(): WizardState
  /** Enqueue a message on the parent interpreter. */
  send(msg: Message, causedBy?: number): void
  /** Forward a child event to the parent's observers. */
  forward(event: DomainEvent): void
}

export interface ChildBridge<H extends ChildHandle, P = Snapshot> {
  create(step: string, context: unknown, causedBy?: number): void
  /** Re-attach a child from what was prepared for it (resume). Throws what the factory throws. */
  restore(step: string, plan: P): void
  send(step: string, command: Command): void
  dispose(step: string): void
  disposeAll(): void
  get(step: string): H | undefined
  has(step: string): boolean
  snapshots(): Record<string, Snapshot>
}

const DEFAULT_MAX_DEPTH = 8

type DepsResolution =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: SerializedError }

interface Attached<H extends ChildHandle> {
  readonly handle: H
  /** Parent flow step token at creation/restore (echoed on every res.child). */
  readonly token: ResultToken
  unobserve: () => void
  unsubscribe: () => void
  lastStatus: WizardStatus | undefined
  pendingPhase: 'compensated' | undefined
}

export function createChildBridge<H extends ChildHandle, P = Snapshot>(
  opts: ChildBridgeOptions<H, P>,
): ChildBridge<H, P> {
  const children = new Map<string, Attached<H>>()
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH

  /** Token of the parent flow step at creation/restore time: `{ step, runId }`. */
  const tokenFor = (step: string): ResultToken => ({
    step,
    runId: opts.getState().steps[step]?.runId ?? 0,
  })

  const fail = (step: string, error: SerializedError, causedBy?: number): void => {
    const known = opts.getState().steps[step]?.child?.seq ?? 0
    opts.send(
      {
        type: 'res.child',
        step,
        token: tokenFor(step),
        summary: { status: 'failed', current: null, progress: 0, seq: known + 1 },
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
    const msg: Extract<Message, { type: 'res.child' }> = {
      type: 'res.child',
      step,
      token: entry.token,
      summary,
      ...(entered && state.status === 'done' ? { done: { output: state.output } } : {}),
      ...(entered && state.status === 'failed' ? { failed: { error: failureOf(state) } } : {}),
      ...(phase !== undefined ? { phase } : {}),
    }
    opts.send(msg)
  }

  const detach = (entry: Attached<H>): void => {
    entry.unobserve()
    entry.unsubscribe()
    entry.handle.dispose()
  }

  const attach = (step: string, handle: H, lastStatus: WizardStatus | undefined): Attached<H> => {
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

  /**
   * The child's deps: run the flow step's RAW `deps` mapper (if any) and parse its value
   * through the child's `deps` boundary exactly once; no mapper → the parent's deps object.
   * Any problem is a `SerializedError` for the flow step (never thrown into the drain).
   */
  const resolveDeps = (
    step: string,
    childDef: CompiledFlow,
    causedBy: number | undefined,
  ): DepsResolution => {
    const mapper = opts.def.steps[step]?.hooks.childDeps
    if (mapper === undefined) return { ok: true, value: opts.deps }
    let mapped: unknown
    try {
      mapped = mapper(opts.hookArgs(step, causedBy))
    } catch (error) {
      return { ok: false, error: toError(error, `deps mapper of '${step}' threw`) }
    }
    if (isThenable(mapped)) {
      return {
        ok: false,
        error: {
          name: 'WizardError',
          code: 'DEFINITION_INVALID',
          message: `deps mapper of '${step}' must be synchronous`,
        },
      }
    }
    const boundary = childDef.deps
    if (boundary === undefined) return { ok: true, value: mapped }
    let result: unknown
    try {
      result = boundary.parse(mapped)
    } catch (error) {
      return { ok: false, error: toError(error, `deps boundary of '${childDef.name}' threw`) }
    }
    if (isThenable(result)) {
      return {
        ok: false,
        error: {
          name: 'WizardError',
          code: 'DEFINITION_INVALID',
          message: `deps boundary of child flow '${childDef.name}' must be synchronous`,
        },
      }
    }
    if (typeof result === 'object' && result !== null && 'ok' in result) {
      if (result.ok === true && 'value' in result) return { ok: true, value: result.value }
      if (result.ok === false) {
        const issues = 'issues' in result && Array.isArray(result.issues) ? result.issues : []
        const detail = issues
          .map((i: unknown) =>
            typeof i === 'object' && i !== null && 'message' in i ? String(i.message) : String(i),
          )
          .join('; ')
        return {
          ok: false,
          error: {
            name: 'BoundaryError',
            code: 'BOUNDARY_REJECTED',
            message: `deps of child flow '${childDef.name}' rejected by boundary${detail.length > 0 ? `: ${detail}` : ''}`,
          },
        }
      }
    }
    return {
      ok: false,
      error: {
        name: 'BoundaryError',
        code: 'BOUNDARY_INVALID_RESULT',
        message: `deps boundary of child flow '${childDef.name}' returned an invalid result`,
      },
    }
  }

  return {
    create(step, context, causedBy) {
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
      const deps = resolveDeps(step, childDef, causedBy)
      if (!deps.ok) {
        fail(step, deps.error, causedBy)
        return
      }
      const handle = opts.factory.create({
        step,
        def: childDef,
        context,
        deps: deps.value,
        path: [...opts.path, step],
        ancestors,
      })
      attach(step, handle, undefined)
      void handle.dispatch({ type: 'start' }).then(noop, noop)
    },

    restore(step, plan) {
      const childDef = childDefOf(step)
      if (childDef === undefined) return
      const deps = resolveDeps(step, childDef, undefined)
      if (!deps.ok) {
        fail(step, deps.error)
        return
      }
      const handle = opts.factory.restore({
        step,
        def: childDef,
        plan,
        deps: deps.value,
        path: [...opts.path, step],
        ancestors: [...opts.ancestors, opts.def.identity],
      })
      const known = opts.getState().steps[step]?.child?.status
      const entry = attach(step, handle, known)
      notify(step, entry, handle.getState())
    },

    send(step, command) {
      const entry = children.get(step)
      if (entry === undefined) return
      void entry.handle.dispatch(command).then(noop, noop)
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
      const out: Record<string, Snapshot> = Object.create(null)
      for (const [step, entry] of children) out[step] = entry.handle.getSnapshot()
      return out
    },
  }
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/**
 * Compact child status for the parent's step record and Mirrors. `progress` is the `progress`
 * selector's ratio over the child's definition (v0.2 §9.6: finals excluded, skipped counts as
 * done, 1 once the child is done).
 */
export function summarize(state: WizardState, def: CompiledFlow): ChildSummary {
  return {
    status: state.status,
    current: state.current,
    progress: progress(state, def).ratio,
    seq: state.seq,
  }
}

/** The error of the (most recently failed) failed step, or a generic child failure. */
function failureOf(state: WizardState): SerializedError {
  let failed: WizardState['steps'][string] | undefined
  for (const rec of Object.values(state.steps)) {
    if (rec.status !== 'failed' || rec.error === undefined) continue
    if (failed?.error === undefined || rec.error.at >= failed.error.at) failed = rec
  }
  if (failed?.error !== undefined) {
    const { name, message, code } = failed.error
    return code === undefined ? { name, message } : { name, message, code }
  }
  return {
    name: 'ChildFlowFailed',
    message: `child flow '${state.flow.name}' failed`,
    code: 'CHILD_FAILED',
  }
}

function toError(error: unknown, fallback: string): SerializedError {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return code === undefined
      ? { name: error.name, message: error.message }
      : { name: error.name, message: error.message, code }
  }
  return { name: 'Error', message: `${fallback}: ${String(error)}` }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  )
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

function noop(): void {}
