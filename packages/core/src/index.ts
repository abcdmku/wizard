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
} from './authoring/run-adapter'
export type { RunFailureKind } from './machine/commands'
export type {
  AnyWizardDefinition,
  AnyStep,
  AnyWizard,
  Boundary,
  Checker,
  ChildWizardOf,
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
  WizardOutput,
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
  WizardHeader,
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
  type TerminalFailure,
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
export type { AnyProjection, ProjectionWizard } from './projection/define-projection'
export type { ProjectionDefinition } from './projection/definition'
// ---- declaration-emit support ------------------------------------------------
// (These names appear in the inferred type of a wizard, a step module, a header object, a
// projection or a store. A consumer compiling with `declaration: true` must be able to name them
// when it exports one, or the compiler reports TS4023 / TS4058. `tests/__declarations__` exports
// one of each, and `pnpm test:canary` compiles it against the built package.)
export type {
  Step,
  StepBinding,
  StepLinks,
  WizardOnArgs,
  WizardStep,
  WizardTypes,
} from './authoring/types'
export type { WizardState } from './machine/state'
export type { MemoryStore } from './persistence/memory-store'
// ---- replay (devtools / audits) ------------------------------------------------
export { replay, type ReplayOptions } from './replay'
