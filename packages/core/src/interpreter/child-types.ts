/** Type contracts for the child-runtime bridge. @internal */

import type { CompiledFlow, HookArgs } from '../authoring/compiled'
import type { Command, Message } from '../machine/commands'
import type { DomainEvent } from '../machine/events'
import type { WizardState } from '../machine/state'
import type { Snapshot } from '../wizard/snapshot'

/** What the bridge needs from a nested runtime (`WizardRuntime` satisfies it). */
export interface ChildHandle {
  getState(): WizardState
  getSnapshot(): Snapshot
  dispatch(command: Command): Promise<unknown>
  subscribe(listener: (state: WizardState) => void): () => void
  observe(listener: (event: DomainEvent) => void): () => void
  /** Activate a passively restored runtime after the parent's resume batch commits. */
  resumePrepared?(): void
  dispose(): void
}

/**
 * A child interpreter's link to the run that embeds it. Its hook calls wait while an ancestor
 * still has messages queued (so a parent `cancel` that a listener queued lands first),
 * and a child that stops on its own (a fatal error, or a direct `dispose()`) fails the flow step.
 */
export interface ParentLink {
  /** True while the parent or one of its ancestors has messages queued. */
  busy(): boolean
  /** Continue the child's drain once those messages are processed. */
  defer(resume: () => void): void
  /** The child stopped: `error` is the fatal error, `undefined` a plain `dispose()`. */
  stopped(error: unknown): void
}

export interface ChildCreateArgs {
  readonly step: string
  readonly def: CompiledFlow
  /** Child context input, already parsed by the child's context boundary. */
  readonly context: unknown
  /** Mapped and parsed child deps, or the parent's deps. */
  readonly deps: unknown
  readonly path: readonly string[]
  readonly ancestors: readonly object[]
  readonly parent: ParentLink
}

/** A prepared child resume plan. The bridge never looks inside `plan`. */
export interface ChildRestoreArgs<P> {
  readonly step: string
  readonly def: CompiledFlow
  readonly plan: P
  readonly deps: unknown
  readonly path: readonly string[]
  readonly ancestors: readonly object[]
  readonly parent: ParentLink
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
  readonly deps?: unknown
  hookArgs(step: string, causedBy?: number): HookArgs
  getState(): WizardState
  /** Override tokens when the bridge addresses a child of one map item. */
  tokenFor?(step: string): import('../machine/commands').ResultToken
  send(msg: Message, causedBy?: number): void
  forward(event: DomainEvent): void
  /** The embedding interpreter's side of every child's `ParentLink` (`busy` / `defer`). */
  readonly turn: Pick<ParentLink, 'busy' | 'defer'>
}

export interface ChildBridge<H extends ChildHandle, P = Snapshot> {
  create(step: string, context: unknown, causedBy?: number, itemIndex?: number): void
  restore(step: string, plan: P): void
  resumeRestored(): void
  send(step: string, command: Command): void
  dispose(step: string): void
  disposeAll(): void
  get(step: string, item?: string | number): H | undefined
  has(step: string): boolean
  snapshots(): Record<string, Snapshot>
}
