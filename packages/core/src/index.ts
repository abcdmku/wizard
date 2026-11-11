/**
 * @openwizard/core — the public surface. This is the main barrel (`@openwizard/core/testing`
 * holds test-only helpers, `@openwizard/core/inspect` the manifest); every symbol below is
 * documented (`@public`) at its declaration and appears in the generated export table.
 *
 * @packageDocumentation
 */

// ---- authoring ---------------------------------------------------------------
// biome-ignore assist/source/organizeImports: hand-grouped by concept (sections below); new sections are appended, never re-sorted
export { boundary } from './authoring/boundary'
export { defineWizard } from './wizard/define-wizard'
export {
  createRunFailure,
  isRunAdapter,
  isRunFailure,
  RUN_ADAPTER,
  type RunAdapter,
  type RunAdapterMetadata,
  type RunFailure,
  type RunFailureKind,
} from './authoring/run-adapter'
export type {
  AnyFlow,
  AnyStep,
  AnyWizard,
  Boundary,
  Checker,
  ChildFlowOf,
  ChildStepId,
  ContextInput,
  ContextPatch,
  Ctx,
  DepsOf,
  DraftOf,
  Duration,
  EachRunArgs,
  ErrorOf,
  EventType,
  Flow,
  FlowOutput,
  HookArgs,
  InputOf,
  IsEach,
  Issue,
  JsonValue,
  NeedRef,
  NeedsOutput,
  NeedsSpec,
  OutputOf,
  PayloadInput,
  PayloadOf,
  Progress,
  RequiredDepsOf,
  RetryStepId,
  RetryPolicy,
  RunArgs,
  SerializedError,
  StepApi,
  StepId,
  StepKind,
  StepStatus,
  RunStepId,
  ViewId,
  WaitHandlers,
  WaitResult,
  Wizard,
  WizardDefinition,
  WizardOptions,
  WizardResumeOptions,
  RunStatus,
} from './authoring/types'
// ---- errors ------------------------------------------------------------------
export { isWizardError, WizardError, type WizardErrorCode } from './errors'
// ---- introspection -----------------------------------------------------------
// (`inspect`, `toMermaid`, `toJSONSchema`, `formatTrace` and the manifest types live in
// `@openwizard/core/inspect`.)
// ---- persistence -------------------------------------------------------------
export { createMemoryStore } from './persistence/memory-store'
export type { Store } from './persistence/store'
export { renameSteps } from './wizard/rename-steps'
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
  type ProjectionScope,
  type ProjectionSelect,
  type ProgressSpec,
  type StepExpose,
  type StepPhase,
} from './projection/define-projection'
// ---- run ------------------------------------------------------------------
export { RUN_EVENT_TYPES } from './machine/events'
export {
  type ChildCommand,
  type ChildRunEvent,
  type Command,
  type DispatchOptions,
  isChildEvent,
  type ResumeOptions,
  type RootRunEvent,
  type SetInputCommand,
  type Snapshot,
  type SnapshotMigration,
  type StepErrorOf,
  type StepState,
  type Run,
  type RunEvent,
  type RunEventType,
  type RunOptions,
  type SendOptions,
} from './wizard/create-wizard'
export { parseCommand } from './wizard/parse-command'
export {
  RunLifecycleError,
  type CompensationFailure,
  type CompensationSummary,
  type CommandResult,
  type FlowFailure,
  type NavResult,
  type RunCancelled,
  type RunDone,
  type RunFailed,
  type RunHalted,
  type RunLifecycleCode,
  type RunOutcome,
  type RunResult,
  type RunWaiting,
  type SendResult,
  type StepFailure,
  type WaitingFor,
} from './wizard/results'
export type { Explanation } from './wizard/create-wizard'
// ---- injectables -------------------------------------------------------------
// (`createTestScheduler` / `TestScheduler` live in `@openwizard/core/testing`.)
export type { Clock, Scheduler } from './interpreter/env'
// Projection extractors let bindings name the wizard and state of a projection.
export type { AnyProjection, ProjectionFlow } from './projection/define-projection'
export type { ProjectionDefinition } from './projection/definition'
// ---- declaration-emit support ------------------------------------------------
// (`Step` / `FlowStep` are the inferred types of `flow.view(…)` results and of `Flow.steps[k]`,
// `MemoryStore` of `createMemoryStore()`; a consumer compiling with `declaration: true` must
// be able to name them when it exports a flow, a step or a store — TS4023 otherwise.)
export type { FlowStep, Step } from './authoring/types'
export type { MemoryStore } from './persistence/memory-store'
// ---- replay (devtools / audits) ------------------------------------------------
export { replay, type ReplayOptions } from './replay'
