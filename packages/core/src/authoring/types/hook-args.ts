/** Hook arguments shared by authoring and the interpreter. */
import type { IsUnset, JsonValue } from './primitives'

/**
 * A shallow context patch that can clear optional properties.
 * It lists the keys to change. An optional key may be cleared with `undefined`.
 * @public
 */
export type ContextPatch<C> = {
  readonly [K in keyof C]?: C[K] | ({} extends Pick<C, K> ? undefined : never)
}
/**
 * Shared hook arguments including typed needs and atomic context updates.
 * Every hook receives them. `N` is the typed `needs` map (`{}` without `needs`).
 * @public
 */
export interface HookArgs<C, D, N = {}> {
  readonly context: C
  /** Patch the context; the function form applies atomically to the latest committed context. */
  readonly update: (patch: ContextPatch<C> | ((current: C) => ContextPatch<C>)) => void
  readonly deps: D
  /** Transient progress, published to observers and never persisted. */
  readonly progress: (value: JsonValue) => void
  readonly needs: N
  readonly step: string
  /** Run path (`[]` for this run, `['fulfil']` inside a child). */
  readonly path: readonly string[]
  readonly signal: AbortSignal
}
/** Entry arguments including the previous view and typed needs. @public */
export interface EnterArgs<C, D, N = {}> extends HookArgs<C, D, N> {
  readonly from: string | null
}
/** Hook arguments carrying a resolved step output. @public */
export interface OutputArgs<C, D, O, N = {}> extends HookArgs<C, D, N> {
  readonly output: O
}
/** Exit arguments with the resolved output and destination view. @public */
export interface ExitArgs<C, D, O, N = {}> extends OutputArgs<C, D, O, N> {
  readonly to: string | null
}
/** Compensation arguments with a stable idempotency key. @public */
export interface CompensateArgs<C, D, O, N = {}> extends OutputArgs<C, D, O, N> {
  readonly reason: string | undefined
  /** Stable per compensation of this step run. */
  readonly idempotencyKey: string
}
/** Run arguments with attempt, idempotency key and typed needs. @public */
export interface RunArgs<C, D, N = {}> extends HookArgs<C, D, N> {
  readonly attempt: number
  readonly idempotencyKey: string
}
interface ItemArgs<Item> {
  readonly item: Item
  readonly index: number
}
/** Run arguments for one item in a mapped runnable step. @public */
export interface EachRunArgs<C, D, N, Item> extends RunArgs<C, D, N>, ItemArgs<Item> {}
/** Hook arguments for one item in a mapped child flow. @public */
interface EachHookArgs<C, D, N, Item> extends HookArgs<C, D, N>, ItemArgs<Item> {}
/** Step event arguments with a parsed payload and typed needs. @public */
export interface EventArgs<C, D, P, E, N = {}> extends HookArgs<C, D, N> {
  readonly event: E
  readonly payload: P
}
export type HookArgsFor<C, D, N, Item> =
  IsUnset<Item> extends true ? HookArgs<C, D, N> : EachHookArgs<C, D, N, Item>

/**
 * Flow event arguments with the parsed event payload.
 * A flow-level handler does not belong to one step, so it has no `step`, `needs` or `progress`.
 * @public
 */
export interface FlowOnArgs<C, D, P, E = string>
  extends Omit<HookArgs<C, D>, 'step' | 'needs' | 'progress'> {
  readonly event: E
  readonly payload: P
}
