/**
 * @openwizard/core — the public surface. This is the main barrel (`@openwizard/core/testing`
 * is the second, smaller entry for test-only helpers); every symbol below is documented
 * (`@public`) at its declaration and appears in the generated export table.
 *
 * @packageDocumentation
 */

// ---- authoring ---------------------------------------------------------------
// biome-ignore assist/source/organizeImports: hand-grouped by concept (sections below); new sections are appended, never re-sorted
export { boundary } from './authoring/boundary'
export { defineFlow } from './authoring/define-flow'
export type {
  AnyFlow,
  Boundary,
  Checker,
  ChildFlowOf,
  ChildStepId,
  ContextInput,
  Ctx,
  DepsOf,
  DraftOf,
  Duration,
  ErrorOf,
  EventType,
  Flow,
  FlowBuilder,
  FlowOutput,
  InputOf,
  Issue,
  OutputOf,
  PayloadOf,
  Progress,
  RetryPolicy,
  SerializedError,
  StepApi,
  StepId,
  StepKind,
  StepStatus,
  TaskId,
  ViewId,
  WaitOutput,
  WizardStatus,
} from './authoring/types'
// ---- errors ------------------------------------------------------------------
export { isWizardError, WizardError, type WizardErrorCode } from './errors'
// ---- introspection -----------------------------------------------------------
export type { FlowWarning } from './authoring/compile'
export { type FlowGraph, inspect } from './inspect/graph'
export { toMermaid } from './inspect/mermaid'
// ---- persistence -------------------------------------------------------------
export { createMemoryStore } from './persistence/memory-store'
export type { Store } from './persistence/store'
// ---- projections -------------------------------------------------------------
export {
  type ChildSummary,
  type ClientState,
  type ClientStepError,
  type ClientStepState,
  defineProjection,
  type ExposeSpec,
  type Projection,
  type ProjectionOutput,
  type ProjectionSelect,
  type StepExpose,
} from './projection/define-projection'
// ---- wizard ------------------------------------------------------------------
export {
  type ChildCommand,
  type ChildWizardEvent,
  type Command,
  createWizard,
  createWizardAsync,
  isChildEvent,
  type ResumeOptions,
  resumeWizard,
  resumeWizardAsync,
  type RootWizardEvent,
  type SetInputCommand,
  type Snapshot,
  type SnapshotMigration,
  type StepErrorOf,
  type StepState,
  type Wizard,
  type WizardEvent,
  type WizardOptions,
} from './wizard/create-wizard'
export { parseCommand } from './wizard/parse-command'
export type { CommandResult, NavResult, SendResult } from './wizard/results'
export type { Explanation } from './wizard/create-wizard'
// ---- injectables -------------------------------------------------------------
// (`createTestScheduler` / `TestScheduler` live in `@openwizard/core/testing`.)
export type { Clock, Scheduler } from './interpreter/env'
// ---- mirror ------------------------------------------------------------------
// (`AnyProjection` / `ProjectionFlow` are the projection extractors the Mirror and the React
// binding are typed with; exported here so `@openwizard/react` can name them.)
export type { AnyProjection, ProjectionFlow } from './projection/define-projection'
export {
  createMirror,
  type Mirror,
  type MirrorChild,
  type MirrorCommands,
  type MirrorOptions,
} from './mirror/create-mirror'
export { createMirrorSource, type MirrorSource } from './mirror/source'
export type { Transport } from './mirror/transport'
export {
  type Frame,
  parseFrame,
  parseWireCommand,
  type WireAck,
  type WireCommand,
} from './mirror/wire'
// ---- declaration-emit support ------------------------------------------------
// (`Step` / `FlowStep` are the inferred types of `s.view(…)` results and of `Flow.steps[k]`,
// `MemoryStore` of `createMemoryStore()`; a consumer compiling with `declaration: true` must
// be able to name them when it exports a flow, a step or a store — TS4023 otherwise.)
export type { FlowStep, Step } from './authoring/types'
export type { MemoryStore } from './persistence/memory-store'
