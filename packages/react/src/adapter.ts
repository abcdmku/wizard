/**
 * Source adapter: the untyped view of what a `Run` and a `Mirror` share (subscribe /
 * getSnapshot / the command sugar), how each exposes the state the hooks read, how a nested
 * flow's slice is found through indexed projected children or the live Run.child handle,
 * where a step's live phase comes from and whether the source is connected.
 * One adapter per source object.
 *
 * @internal
 */

import type { ChildPath } from './child-path'

/** The command sugar the hooks call (`Run` and `Mirror` both carry it, this-free). */
export interface RawActions {
  next(): Promise<unknown>
  back(): Promise<unknown>
  go(step: string): Promise<unknown>
  setInput(step: string, patch: unknown): Promise<unknown>
  resetInput(step: string): Promise<unknown>
  dispatch(command: unknown): Promise<unknown>
}

/** Structural view of what `Run` and `Mirror` share. */
interface RawSource extends RawActions {
  subscribe(listener: () => void): () => void
  getSnapshot(): unknown
}

/** The Run-only part: its state, queries and live children. */
interface RawRun extends RawSource {
  getState(): unknown
  explain(step: string): { readonly phase?: string }
  child(step: string, index?: number): RawRun
}

/** The Mirror-only part: its transport connection. */
interface RawMirror extends RawSource {
  readonly connected: boolean
  connect(transport?: unknown): void
}

export interface RawState {
  readonly current: string | null
  readonly steps: Readonly<Record<string, unknown>>
}

export interface Adapter {
  subscribe(listener: () => void): () => void
  /** The state the hooks read; `null` while a Mirror has no frame. */
  getState(): RawState | null
  /** The state slice of a nested flow (`path` of flow-step ids); `null` while it has none. */
  getChildState(path: ChildPath): RawState | null
  /**
   * The live phase of a step of the flow at `path`: `explain(step).phase` on the run (a Run's
   * records do not carry it); `undefined` over a Mirror (its projected records do).
   */
  phaseOf(path: ChildPath, step: string): string | undefined
  /** A Mirror's transport state (`true` for a Run: it is local). */
  connected(): boolean
  /** Re-subscribe a Mirror to its transport (a no-op for a Run). */
  connect(transport?: unknown): void
  /** The source itself: its command sugar (+ `validate` / `explain` / `progress` over a Run). */
  readonly actions: RawActions
}

const adapters = new WeakMap<object, Adapter>()

export function adapt(source: object): Adapter {
  const existing = adapters.get(source)
  if (existing !== undefined) return existing
  const adapter = isRun(source) ? runAdapter(source) : mirrorAdapter(source as RawMirror)
  adapters.set(source, adapter)
  return adapter
}

function isRun(source: object): source is RawRun {
  return typeof (source as { getState?: unknown }).getState === 'function'
}

function runAdapter(run: RawRun): Adapter {
  return {
    subscribe: run.subscribe,
    getState: () => run.getState() as RawState,
    getChildState: (path) => (runChild(run, path)?.getState() as RawState | undefined) ?? null,
    phaseOf: (path, step) => runPhase(run, path, step),
    connected: () => true,
    connect: () => {},
    actions: run,
  }
}

function mirrorAdapter(mirror: RawMirror): Adapter {
  const getState = () => mirror.getSnapshot() as RawState | null
  return {
    subscribe: mirror.subscribe,
    getState,
    getChildState: (path) => childOfProjected(getState(), path),
    phaseOf: () => undefined,
    connected: () => mirror.connected,
    connect: mirror.connect,
    actions: mirror,
  }
}

/** Follow explicitly selected live children, including completed retained handles. */
function runChild(run: RawRun, path: ChildPath): RawRun | undefined {
  let scope = run
  for (const { step, index } of path) {
    try {
      scope = scope.child(step, index)
    } catch {
      return undefined // the flow step is not active: no live child, no phase
    }
  }
  return scope
}

function runPhase(run: RawRun, path: ChildPath, step: string): string | undefined {
  return runChild(run, path)?.explain(step).phase
}

/** The child slice of a projected state: `steps[p0].child.steps[p1].child…` (`null` when absent). */
function childOfProjected(state: RawState | null, path: ChildPath): RawState | null {
  let slice: RawState | null = state
  for (const { step, index } of path) {
    if (slice === null) return null
    const record = slice.steps[step] as { readonly child?: unknown } | undefined
    const child =
      index === undefined
        ? record?.child
        : Array.isArray(record?.child)
          ? record.child[index]
          : undefined
    slice = isRawState(child) ? child : null
  }
  return slice
}

function isRawState(value: unknown): value is RawState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'steps' in value &&
    typeof (value as { steps?: unknown }).steps === 'object'
  )
}
