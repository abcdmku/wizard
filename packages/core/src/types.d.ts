/**
 * Core TypeScript types for the wizard library
 */
/**
 * Configuration for a multi-step wizard
 * @template C - Global shared context type across all steps
 * @template S - Union of step IDs (string literal union)
 * @template D - Per-step data map, keyed by S
 * @template E - Optional union of event types for orchestration
 */
export type WizardConfig<C, S extends string, D extends Record<S, unknown>, E = never> = {
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
    next: S[] | ((args: {
        ctx: Readonly<C>;
        data: Readonly<Data>;
    }) => S | readonly S[]);
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
    canEnter?: (args: {
        ctx: Readonly<C>;
    }) => boolean | Promise<boolean>;
    /** Optional guard to allow leaving */
    canExit?: (args: {
        ctx: Readonly<C>;
        data: Readonly<Data>;
    }) => boolean | Promise<boolean>;
};
/**
 * Current state of the wizard
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 */
export type WizardState<C, S extends string, D extends Record<S, unknown>> = {
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
};
/**
 * Transition event emitted when moving between steps
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 * @template E - Event types
 */
export type WizardTransitionEvent<C, S extends string, D extends Record<S, unknown>, _E> = {
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
export type WizardPersistence<C, S extends string, D extends Record<S, unknown>> = {
    /** Save current state */
    save: (state: WizardState<C, S, D>) => void | Promise<void>;
    /** Load saved state */
    load?: () => WizardState<C, S, D> | null | Promise<WizardState<C, S, D> | null>;
    /** Clear saved state */
    clear?: () => void | Promise<void>;
};
/**
 * Main wizard instance API
 * @template C - Global shared context type
 * @template S - Union of step IDs
 * @template D - Per-step data map
 * @template E - Event types
 */
export type Wizard<C, S extends string, D extends Record<S, unknown>, E = never> = {
    /** Reactive store (TanStack Store) */
    store: import('@tanstack/store').Store<WizardState<C, S, D>>;
    /** Validate and go to next step (inferred by current step) */
    next: (args?: {
        data?: D[S];
    }) => Promise<void>;
    /** Jump to specific step (honors canEnter/canExit) */
    goTo: (step: S, args?: {
        data?: D[S];
    }) => Promise<void>;
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
};
//# sourceMappingURL=types.d.ts.map