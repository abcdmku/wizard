/**
 * Source adapter: the untyped view of what a `Wizard` and a `Mirror` share (subscribe /
 * getSnapshot / the command sugar), how each exposes the state the hooks read, and how a nested
 * flow's slice is found (`steps[step].child…` of a projected state, `children[step].state` of a
 * wizard snapshot). One adapter per source object.
 *
 * @internal
 */

/** Structural view of what `Wizard` and `Mirror` share (plus `getState`, Wizard only). */
export interface RawSource extends RawActions {
  subscribe(listener: (state?: unknown) => void): () => void
  getSnapshot(): unknown
  getState?(): unknown
}

export interface RawState {
  readonly current: string | null
  readonly steps: Readonly<Record<string, unknown>>
}

/** A Wizard snapshot as the child reader walks it (`children[step].state`). */
interface RawSnapshot {
  readonly state: RawState
  readonly children?: Readonly<Record<string, RawSnapshot | undefined>>
}

export interface RawActions {
  start(): Promise<unknown>
  next(): Promise<unknown>
  back(): Promise<unknown>
  go(step: string): Promise<unknown>
  setInput(step: string, patch: unknown): Promise<unknown>
  resetInput(step: string): Promise<unknown>
  send(
    event: string,
    payload: unknown,
    options?: { readonly correlationId?: string },
  ): Promise<unknown>
  run(step: string): Promise<unknown>
  retry(step: string): Promise<unknown>
  cancel(reason?: string): Promise<unknown>
  runReady(): Promise<unknown>
  compensate(options?: { readonly from?: string; readonly reason?: string }): Promise<unknown>
  reset(): Promise<unknown>
  skip(step: string, reason?: string): Promise<unknown>
  invalidate(step: string, options?: { readonly cascade?: boolean }): Promise<unknown>
  dispatch(command: unknown): Promise<unknown>
}

export interface Adapter {
  subscribe(listener: () => void): () => void
  /** The state the hooks read; `null` while a Mirror has no frame. */
  getState(): RawState | null
  /** The state slice of a nested flow (`path` of flow-step ids); `null` while it has none. */
  getChildState(path: readonly string[]): RawState | null
  /**
   * The child slice inside a FIXED server snapshot (`Provider.serverSnapshot`): walked from the
   * projected state over a Mirror; `null` over a Wizard (its `serverSnapshot` is the wizard
   * state, which carries child summaries only).
   */
  childOfServerState(state: RawState, path: readonly string[]): RawState | null
  readonly actions: RawActions
}

/** What a `Provider` puts in context: the source adapter plus the fixed server snapshot reader. */
export interface Bound {
  readonly adapter: Adapter
  /** The state to render on the server and during hydration (`serverSnapshot`, else the live state). */
  getServerState(): RawState | null
  /** The child slice to render on the server and during hydration (walked from the fixed snapshot). */
  getServerChildState(path: readonly string[]): RawState | null
}

const adapters = new WeakMap<object, Adapter>()

/** The child slice of a projected state: `steps[p0].child.steps[p1].child…` (`null` when absent). */
function childOfProjected(state: RawState | null, path: readonly string[]): RawState | null {
  let slice: RawState | null = state
  for (const step of path) {
    if (slice === null) return null
    const record = slice.steps[step] as { readonly child?: unknown } | undefined
    const child = record?.child
    slice = isRawState(child) ? child : null
  }
  return slice
}

/** The child slice of a Wizard snapshot: `children[p0].children[p1]….state` (`null` when absent). */
function childOfSnapshot(snapshot: RawSnapshot, path: readonly string[]): RawState | null {
  let node: RawSnapshot | undefined = snapshot
  for (const step of path) {
    node = node?.children?.[step]
    if (node === undefined) return null
  }
  return node === undefined ? null : node.state
}

function isRawState(value: unknown): value is RawState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'steps' in value &&
    typeof (value as { steps?: unknown }).steps === 'object'
  )
}

export function adapt(source: object): Adapter {
  const existing = adapters.get(source)
  if (existing !== undefined) return existing
  const raw = source as RawSource
  const wizardState = raw.getState
  const isWizard = typeof wizardState === 'function'
  const getState = isWizard
    ? () => wizardState.call(raw) as RawState // Wizard: the state (never null)
    : () => raw.getSnapshot() as RawState | null // Mirror: projected state, null before the first frame
  const adapter: Adapter = {
    subscribe: (listener) => raw.subscribe(() => listener()),
    getState,
    getChildState: isWizard
      ? (path) => childOfSnapshot(raw.getSnapshot() as RawSnapshot, path)
      : (path) => childOfProjected(getState(), path),
    childOfServerState: isWizard ? () => null : childOfProjected,
    actions: {
      start: () => raw.start(),
      next: () => raw.next(),
      back: () => raw.back(),
      go: (step) => raw.go(step),
      setInput: (step, patch) => raw.setInput(step, patch),
      resetInput: (step) => raw.resetInput(step),
      send: (event, payload, options) =>
        options === undefined ? raw.send(event, payload) : raw.send(event, payload, options),
      run: (step) => raw.run(step),
      retry: (step) => raw.retry(step),
      cancel: (reason) => (reason === undefined ? raw.cancel() : raw.cancel(reason)),
      runReady: () => raw.runReady(),
      compensate: (options) => (options === undefined ? raw.compensate() : raw.compensate(options)),
      reset: () => raw.reset(),
      skip: (step, reason) => (reason === undefined ? raw.skip(step) : raw.skip(step, reason)),
      invalidate: (step, options) =>
        options === undefined ? raw.invalidate(step) : raw.invalidate(step, options),
      dispatch: (command) => raw.dispatch(command),
    },
  }
  adapters.set(source, adapter)
  return adapter
}
