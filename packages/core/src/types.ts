/**
 * Core TypeScript types for the wizard library
 */

/**
 * Step status types for progress tracking.
 * Represents the current state of a step in the wizard.
 */
export type StepStatus =
  | 'unavailable'  // blocked by guards/prereqs; cannot enter now
  | 'optional'     // step is not required for completion (meta)
  | 'current'      // active step
  | 'completed'    // finished successfully
  | 'required'     // must be completed for overall completion (meta)
  | 'skipped'      // intentionally bypassed
  | 'error'        // failed but retryable/fixable
  | 'terminated'   // permanently failed/unrecoverable (terminal)
  | 'loading';     // async work in progress for the step

/**
 * Configuration for a multi-step wizard
 * @template C - Global shared context type across all steps
 * @template S - Union of step IDs (string literal union)
 * @template D - Per-step data map, keyed by S
 * @template E - Optional union of event types for orchestration
 */
export type WizardConfig<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
> = {
  /** Initial step to start the wizard */
  initialStep: S;
  /** Initial shared context across all steps */
  initialContext: C;
  /** Step definitions keyed by step ID */
  steps: {
    [K in S]: StepDefinition<C, S, D[K], E>;
  };
  /** Optional global transition handler */
  onTransition?: (ev: WizardTransitionEvent<C, S, D, E>) => void | Promise<void>;
  /** Optional persistence adapter */
  persistence?: WizardPersistence<C, S, D>;
  /** Whether to keep history for back/undo (default: true) */
  keepHistory?: boolean;
  /** Maximum history entries to keep (default: 10) */
  maxHistorySize?: number;

  // New optional fields for helpers
  /** Explicit linear order for steps */
  order?: readonly S[];

  /**
   * Progress weighting for steps
   * @deprecated Use step.weight instead - will be removed in next major version
   */
  weights?: Partial<Record<S, number>>;

  /**
   * Simple DAG prerequisites
   * @deprecated Use step.prerequisites instead - will be removed in next major version
   */
  prerequisites?: Partial<Record<S, readonly S[]>>;

  /**
   * Custom completion check for steps
   * @deprecated Use step.complete instead - will be removed in next major version
   */
  isStepComplete?: (args: { step: S; data: Partial<D>; ctx: Readonly<C> }) => boolean;

  // Status/meta hints (do not set state; used by helpers):
  /**
   * Check if a step is optional
   * @deprecated Use step.required instead (with inverted logic) - will be removed in next major version
   */
  isOptional?: (step: S, ctx: Readonly<C>) => boolean;

  /**
   * Check if a step is required (default true unless optional)
   * @deprecated Use step.required instead - will be removed in next major version
   */
  isRequired?: (step: S, ctx: Readonly<C>) => boolean;

  // Lifecycle/error hooks (optional):
  /** Hook for status changes */
  onStatusChange?: (args: { step: S; prev?: StepStatus; next: StepStatus }) => void;
};

/**
 * Definition for a single step in the wizard
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template Data - Data type for this specific step
 * @template E - Event types
 */
export type StepDefinition<C, S extends string, Data, E> = {
  /** Optional schema validator for step data */
  validate?: (data: unknown, ctx: Readonly<C>) => asserts data is Data;

  /** Allowed next steps - can be static list or function based on context/data */
  next:
    | S[]
    | ((args: { ctx: Readonly<C>; data: Readonly<Data> }) => S | readonly S[]);

  /** Side effects before leaving the step */
  beforeExit?: (args: {
    ctx: Readonly<C>;
    data: Readonly<Data>;
    updateContext: (updater: (ctx: C) => void) => void;
    emit: (event: E) => void;
  }) => void | Promise<void>;

  /** Optional async loader for the step */
  load?: (args: {
    ctx: Readonly<C>;
    setStepData: (data: Data) => void;
    updateContext: (updater: (ctx: C) => void) => void;
  }) => void | Promise<void>;

  /** Optional guard to allow entry */
  canEnter?: (args: { ctx: Readonly<C> }) => boolean | Promise<boolean>;

  /** Optional guard to allow leaving */
  canExit?: (args: {
    ctx: Readonly<C>;
    data: Readonly<Data>
  }) => boolean | Promise<boolean>;

  // NEW step-level attributes
  /** Whether this step is required (default: true) */
  required?: boolean | ((ctx: Readonly<C>) => boolean);

  /** Custom completion check or static state */
  complete?: boolean | ((data: Data | undefined, ctx: Readonly<C>) => boolean);

  /** Steps that must be completed before this step */
  prerequisites?: S[];

  /** Weight for progress calculation (default: 1) */
  weight?: number | ((ctx: Readonly<C>) => number);
};

/**
 * Flexible step definition that supports type inference
 * This variant allows validators and loaders to define the data type
 */
export type StepDefinitionInfer<_C = any, S extends string = string, _E = any> = {
  /** Optional validator - can be any function or object with parse method */
  validate?: any;

  /** Allowed next steps */
  next: S[] | ((args: any) => S | readonly S[]);

  /** Optional loader that returns data */
  load?: (args: any) => any | Promise<any>;

  /** Explicit data type hint */
  data?: any;

  /** Side effects before leaving the step */
  beforeExit?: (args: any) => void | Promise<void>;

  /** Optional guard to allow entry */
  canEnter?: (args: any) => boolean | Promise<boolean>;

  /** Optional guard to allow leaving */
  canExit?: (args: any) => boolean | Promise<boolean>;

  // NEW step-level attributes
  /** Whether this step is required (default: true) */
  required?: boolean | ((ctx: any) => boolean);

  /** Custom completion check or static state */
  complete?: boolean | ((data: any, ctx: any) => boolean);

  /** Steps that must be completed before this step */
  prerequisites?: S[];

  /** Weight for progress calculation (default: 1) */
  weight?: number | ((ctx: any) => number);
};

/**
 * Runtime marks for step tracking.
 * Stores metadata about step execution and state changes.
 */
export type StepRuntime = {
  /** Last explicit status override */
  status?: StepStatus;
  /** Number of attempts */
  attempts?: number;
  /** Start timestamp in ms epoch */
  startedAt?: number;
  /** Finish timestamp in ms epoch */
  finishedAt?: number;
};

/**
 * Current state of the wizard
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 */
export type WizardState<
  C,
  S extends string,
  D extends Record<S, unknown>
> = {
  /** Current step ID */
  step: S;
  /** Global shared context */
  context: C;
  /** Per-step data snapshot map */
  data: Partial<D>;
  /** Last validation error per step */
  errors: Partial<Record<S, unknown>>;
  /** History for back/undo/time-travel */
  history: Array<{
    step: S;
    context: C;
    data: Partial<D>;
  }>;
  /** Loading state for async operations */
  isLoading: boolean;
  /** Currently transitioning to a new step */
  isTransitioning: boolean;
  /** Optional per-step runtime marks */
  runtime?: Partial<Record<S, StepRuntime>>;
};

/**
 * Transition event emitted when moving between steps
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 * @template E - Event types
 */
export type WizardTransitionEvent<
  C,
  S extends string,
  D extends Record<S, unknown>,
  _E
> = {
  /** Previous step ID */
  from: S;
  /** Next step ID */
  to: S;
  /** Current context */
  context: Readonly<C>;
  /** Current data snapshot */
  data: Readonly<Partial<D>>;
  /** Transition type */
  type: 'next' | 'back' | 'goto';
};

/**
 * Persistence interface for saving/loading wizard state
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 */
export type WizardPersistence<
  C,
  S extends string,
  D extends Record<S, unknown>
> = {
  /** Save current state */
  save: (state: WizardState<C, S, D>) => void | Promise<void>;
  /** Load saved state */
  load?: () => WizardState<C, S, D> | null | Promise<WizardState<C, S, D> | null>;
  /** Clear saved state */
  clear?: () => void | Promise<void>;
};

/**
 * Wizard helpers for enhanced functionality.
 * Provides extensive utility methods for querying and managing wizard state.
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 */
export interface WizardHelpers<C, S extends string, D extends Record<S, unknown>> {
  // Identity & ordering
  allSteps(): readonly S[];
  orderedSteps(): readonly S[];
  stepCount(): number;
  stepIndex(step: S): number;
  currentIndex(): number;

  // Classification & status
  stepStatus(step: S): StepStatus;
  isOptional(step: S): boolean;
  isRequired(step: S): boolean;

  // Availability
  availableSteps(): readonly S[];
  unavailableSteps(): readonly S[];
  refreshAvailability(): Promise<void>;

  // Completion & progress
  completedSteps(): readonly S[];
  remainingSteps(): readonly S[];
  firstIncompleteStep(): S | null;
  lastCompletedStep(): S | null;
  remainingRequiredCount(): number;
  isComplete(): boolean;
  progress(): { ratio: number; percent: number; label: string };

  // Navigation affordances
  canGoNext(): boolean;
  canGoBack(): boolean;
  canGoTo(step: S): boolean;
  findNextAvailable(from?: S): S | null;
  findPrevAvailable(from?: S): S | null;
  jumpToNextRequired(): S | null;

  // Reachability & graph introspection
  isReachable(step: S): boolean;
  prerequisitesFor(step: S): readonly S[];
  successorsOf(step: S): readonly S[];

  // Diagnostics
  stepAttempts(step: S): number;
  stepDuration(step: S): number | null;
  percentCompletePerStep(): Record<S, number>;

  // Snapshots
  snapshot(): WizardState<C, S, D>;
}

/**
 * Step metadata information.
 * Aggregated information about a step's current state and position.
 */
export type StepMeta = {
  status: StepStatus;
  required: boolean;
  optional: boolean;
  index: number;
  isBeforeCurrent: boolean;
  isAfterCurrent: boolean;
};

/**
 * Main wizard instance API
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 * @template E - Event types
 */
export type Wizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
> = {
  /** Reactive store (TanStack Store) */
  store: import('@tanstack/store').Store<WizardState<C, S, D>>;

  /** Validate and go to next step (inferred by current step) */
  next: (args?: { data?: D[S] }) => Promise<void>;

  /** Jump to specific step (honors canEnter/canExit) */
  goTo: (step: S, args?: { data?: D[S] }) => Promise<void>;

  /** Go back to previous step (if history enabled) */
  back: () => Promise<void>;

  /** Reset wizard to initial state */
  reset: () => void;

  /** Update shared context */
  updateContext: (updater: (ctx: C) => void) => void;

  /** Set data for a specific step */
  setStepData: (step: S, data: D[S]) => void;

  /** Get current context (readonly) */
  getContext: () => Readonly<C>;

  /** Get current step info */
  getCurrent: () => {
    step: S;
    data: Readonly<D[S]> | undefined;
    ctx: Readonly<C>;
  };

  /** Get data for a specific step */
  getStepData: <K extends S>(step: K) => D[K] | undefined;

  /** Subscribe to state changes */
  subscribe: (cb: (state: WizardState<C, S, D>) => void) => () => void;

  /** Emit custom event */
  emit: (event: E) => void;

  /** Get state snapshot */
  snapshot: () => WizardState<C, S, D>;

  /** Restore from snapshot */
  restore: (snap: WizardState<C, S, D>) => void;

  /** Destroy wizard and cleanup */
  destroy: () => void;

  // Mark methods for status management
  markError: (step: S, err: unknown) => void;
  markTerminated: (step: S, err?: unknown) => void;
  markLoading: (step: S) => void;
  markIdle: (step: S) => void;
  markSkipped: (step: S) => void;

  // Helpers instance
  helpers: WizardHelpers<C, S, D>;
};

/**
 * Type inference utilities for automatic type extraction from wizard configurations
 */

// Extract step names from config
export type InferSteps<T> = T extends { steps: infer S }
  ? keyof S extends string ? keyof S : never
  : never;

// Infer data from various validator patterns
type UnwrapPromise<T> = T extends PromiseLike<infer U> ? UnwrapPromise<U> : T;

type ExtractCallableResult<R> =
  UnwrapPromise<R> extends { success: true; data: infer D }
    ? D
    : [UnwrapPromise<R>] extends [void | never]
      ? unknown
      : [unknown] extends [UnwrapPromise<R>]
        ? unknown
        : UnwrapPromise<R>;

type FirstNonNever<A, B> = [A] extends [never] ? B : A;

type AssertionWithContext<V> = V extends (data: unknown, ctx?: any) => asserts data is infer D
  ? ReturnType<V> extends void ? D : never
  : never;

type AssertionWithoutContext<V> = V extends (data: unknown) => asserts data is infer D
  ? ReturnType<V> extends void ? D : never
  : never;

type AssertionWithThisAndContext<V> = V extends (this: any, data: unknown, ctx?: any) => asserts data is infer D
  ? ReturnType<V> extends void ? D : never
  : never;

type AssertionWithThis<V> = V extends (this: any, data: unknown) => asserts data is infer D
  ? ReturnType<V> extends void ? D : never
  : never;

type TypeGuardWithThis<V> =
  V extends (this: any, data: unknown, ...args: any[]) => data is infer D ? D : never;

type TypeGuard<V> =
  V extends (data: unknown, ...args: any[]) => data is infer D ? D : never;

type ParseResult<V> =
  V extends { parse: (data: unknown, ...args: any[]) => infer R } ? ExtractCallableResult<R> : never;

type SafeParseResult<V> =
  V extends { safeParse: (data: unknown, ...args: any[]) => infer R } ? ExtractCallableResult<R> : never;

type FunctionWithThisResult<V> =
  V extends (this: any, ...args: any[]) => any ? ExtractCallableResult<ReturnType<V>> : never;

type FunctionResult<V> =
  V extends (...args: any[]) => any ? ExtractCallableResult<ReturnType<V>> : never;

export type InferValidatorData<V> =
  FirstNonNever<
    AssertionWithContext<V>,
    FirstNonNever<
      AssertionWithoutContext<V>,
      FirstNonNever<
        AssertionWithThisAndContext<V>,
        FirstNonNever<
          AssertionWithThis<V>,
          FirstNonNever<
            TypeGuardWithThis<V>,
            FirstNonNever<
              TypeGuard<V>,
              FirstNonNever<
                ParseResult<V>,
                FirstNonNever<
                  SafeParseResult<V>,
                  FirstNonNever<
                    FunctionWithThisResult<V>,
                    FirstNonNever<FunctionResult<V>, unknown>
                  >
                >
              >
            >
          >
        >
      >
    >
  >;

// Extract data type from step definition
export type InferStepData<T> =
  T extends { validate: infer V } ? InferValidatorData<V> :
  T extends { load: (...args: any[]) => infer D | Promise<infer D> } ? Awaited<D> :
  T extends { data?: infer D } ? D :
  unknown;

// Build data map from steps
export type InferDataMap<T> = T extends { steps: infer S }
  ? { [K in keyof S]: InferStepData<S[K]> }
  : never;

// Extract context from config
export type InferContext<T> = T extends { initialContext: infer C } ? C : {};
