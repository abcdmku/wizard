/**
 * @wizard/core - Main Wizard Implementation
 * Complete factory implementation with @tanstack/store integration
 */

import { Store } from '@tanstack/store';
import type {
  Wizard,
  WizardState,
  WizardHelpers,
  StepIds,
  StepStatus,
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
  EnhancedDataMapFromDefs,
} from './types';
import { resolve } from './types';
import { createStepWrapper, createCurrentStepWrapper, type WizardStep } from './step-wrapper';

export function createWizard<C, E, TDefs extends Record<string, any>>(opts: {
  context: C;
  steps: TDefs;
  order?: readonly (keyof TDefs & string)[];
  onStatusChange?: (a: { step: keyof TDefs & string; prev?: StepStatus; next: StepStatus }) => void;
}): Wizard<C, StepIds<TDefs>, EnhancedDataMapFromDefs<TDefs>, E> {
  type S = StepIds<TDefs>;
  type D = EnhancedDataMapFromDefs<TDefs>;

  const { context: initialContext, steps, order } = opts;

  // Determine step order: explicit order → topological → declaration order
  const allStepIds = Object.keys(steps) as S[];
  const orderedSteps = order ? [...order] as S[] : allStepIds;

  // Initialize data from step definitions
  const initialData = {} as Partial<D>;
  const initialMeta = {} as Partial<Record<S, import('./types').StepMetaCore<C, S, unknown, never>>>;
  for (const stepName of allStepIds) {
    const stepDef = steps[stepName];
    if (stepDef.data !== undefined) {
      initialData[stepName as keyof D] = stepDef.data as D[keyof D];
    }
    if (stepDef.meta !== undefined) {
      initialMeta[stepName] = stepDef.meta;
    }
  }

  // Initialize store with @tanstack/store
  const initialState: WizardState<C, S, D> = {
    step: orderedSteps[0],
    context: structuredClone(initialContext),
    data: initialData,
    meta: initialMeta,
    errors: {},
    history: [],
    isLoading: false,
    isTransitioning: false,
    runtime: {},
  };

  const store = new Store(initialState);

  // Cache for availability checks
  let availabilityCache = new Map<S, boolean>();

  // Helper to create step arguments
  const createStepArgs = <Data>(step: S, data: Data): StepArgs<C, S, Data, E> => ({
    step,
    context: store.state.context,
    data,
    updateContext: (fn: (context: C) => void) => {
      store.setState((state) => {
        const newContext = structuredClone(state.context);
        fn(newContext);
        return { ...state, context: newContext };
      });
    },
    setStepData: (newData: Data) => {
      store.setState((state) => ({
        ...state,
        data: { ...state.data, [step]: newData },
      }));
    },
    emit: (_event: E) => {
      // Event emission logic can be added here
    },
    getAllStepNames: () => allStepIds,
  });

  // Helper to update runtime state
  const updateRuntime = (step: S, updates: Partial<{ status?: StepStatus; attempts?: number; startedAt?: number; finishedAt?: number }>) => {
    store.setState(state => {
      const newRuntime = { ...state.runtime } as Partial<Record<S, {
        status?: StepStatus; attempts?: number; startedAt?: number; finishedAt?: number;
      }>>;
      newRuntime[step] = {
        ...newRuntime[step],
        ...updates,
      };
      return {
        ...state,
        runtime: newRuntime,
      };
    });
  };

  // Helper functions implementation (24 functions as per PRP)
  const helpers: WizardHelpers<C, S, D> = {
    // Step name helpers
    allStepNames: () => allStepIds,
    orderedStepNames: () => orderedSteps,

    // Step object helpers - These will be defined after wizard is created
    allSteps: () => [] as ReadonlyArray<WizardStep<S, D[S], C, S, D>>,
    orderedSteps: () => [] as ReadonlyArray<WizardStep<S, D[S], C, S, D>>,
    stepCount: () => orderedSteps.length,
    stepIndex: (step: S) => orderedSteps.indexOf(step),
    currentIndex: () => orderedSteps.indexOf(store.state.step),

    stepStatus: (step: S): StepStatus => {
      const runtime = store.state.runtime?.[step];
      if (runtime?.status) return runtime.status;

      if (step === store.state.step) return 'current';
      if (store.state.data[step] !== undefined) return 'completed';
      if (!availabilityCache.get(step)) return 'unavailable';

      const stepDef = steps[step];
      const args = createStepArgs(step, store.state.data[step]);
      const isRequired = resolve(stepDef?.required ?? true, args);
      return isRequired ? 'required' : 'optional';
    },

    isOptional: (step: S) => {
      const stepDef = steps[step];
      const args = createStepArgs(step, store.state.data[step]);
      return !resolve(stepDef?.required ?? true, args);
    },

    isRequired: (step: S) => {
      const stepDef = steps[step];
      const args = createStepArgs(step, store.state.data[step]);
      return resolve(stepDef?.required ?? true, args);
    },

    availableStepNames: () => {
      return orderedSteps.filter(step => {
        const stepDef = steps[step];
        if (!stepDef.canEnter) return true;

        const args: StepEnterArgs<C, S, any, E> = {
          ...createStepArgs(step, store.state.data[step]),
          from: store.state.step,
        };

        return resolve(stepDef.canEnter, args);
      });
    },

    availableSteps: () => [] as ReadonlyArray<WizardStep<S, D[S], C, S, D>>,

    unavailableStepNames: () => {
      return orderedSteps.filter(step => !helpers.availableStepNames().includes(step));
    },

    unavailableSteps: () => [] as ReadonlyArray<WizardStep<S, D[S], C, S, D>>,

    refreshAvailability: async () => {
      availabilityCache.clear();
      for (const step of orderedSteps) {
        const stepDef = steps[step];
        if (stepDef.canEnter) {
          const args: StepEnterArgs<C, S, any, E> = {
            ...createStepArgs(step, store.state.data[step]),
            from: store.state.step,
          };
          const canEnter = await Promise.resolve(resolve(stepDef.canEnter, args));
          availabilityCache.set(step, canEnter);
        } else {
          availabilityCache.set(step, true);
        }
      }
    },

    completedStepNames: () => {
      return orderedSteps.filter(step => {
        const stepDef = steps[step];
        if (stepDef.complete) {
          const args = createStepArgs(step, store.state.data[step]);
          return resolve(stepDef.complete, args);
        }
        return store.state.data[step] !== undefined;
      });
    },

    completedSteps: () => [] as ReadonlyArray<WizardStep<S, D[S], C, S, D>>,

    remainingStepNames: () => {
      const completed = helpers.completedStepNames();
      return orderedSteps.filter(step => !completed.includes(step));
    },

    remainingSteps: () => [] as ReadonlyArray<WizardStep<S, D[S], C, S, D>>,

    firstIncompleteStep: () => {
      const remaining = helpers.remainingSteps();
      return remaining.length > 0 ? remaining[0] : null;
    },

    firstIncompleteStepName: () => {
      const remaining = helpers.remainingStepNames();
      return remaining.length > 0 ? remaining[0] : null;
    },

    lastCompletedStep: () => {
      const completed = helpers.completedSteps();
      return completed.length > 0 ? completed[completed.length - 1] : null;
    },

    lastCompletedStepName: () => {
      const completed = helpers.completedStepNames();
      return completed.length > 0 ? completed[completed.length - 1] : null;
    },

    remainingRequiredCount: () => {
      return helpers.remainingStepNames().filter(stepName => helpers.isRequired(stepName)).length;
    },

    isComplete: () => {
      return helpers.remainingRequiredCount() === 0;
    },

    progress: () => {
      const total = orderedSteps.filter(step => helpers.isRequired(step)).length;
      const completed = helpers.completedStepNames().filter(stepName => helpers.isRequired(stepName)).length;
      const ratio = total > 0 ? completed / total : 1;
      return {
        ratio,
        percent: Math.round(ratio * 100),
        label: `${completed}/${total} steps completed`,
      };
    },

    canGoNext: () => {
      const currentStep = store.state.step;
      const stepDef = steps[currentStep];

      // Check if current step can be exited
      if (stepDef.canExit) {
        const args: StepExitArgs<C, S, any, E> = {
          ...createStepArgs(currentStep, store.state.data[currentStep]),
          to: null, // Will be determined by next logic
        };
        if (!resolve(stepDef.canExit, args)) return false;
      }

      return helpers.findNextAvailableName() !== null;
    },

    canGoBack: () => {
      return store.state.history.length > 0;
    },

    canGoTo: (step: S) => {
      return helpers.availableStepNames().includes(step);
    },

    findNextAvailableName: (from?: S) => {
      const currentStep = from || store.state.step;
      const currentStepDef = steps[currentStep];
      const available = helpers.availableStepNames();

      // Get the next field from step definition
      let nextCandidates: readonly S[] | "any" | null = null;
      if (currentStepDef?.next !== undefined) {
        const nextField = currentStepDef.next;
        if (typeof nextField === 'function') {
          const currentData = store.state.data[currentStep];
          const args = createStepArgs(currentStep, currentData);
          const result = nextField(args);
          nextCandidates = result;
        } else {
          nextCandidates = nextField;
        }
      }

      // If next is "any", return the first available step
      if (nextCandidates === "any") {
        return available.length > 0 ? available[0] : null;
      }

      // If next is an array, find the first available step in that array
      if (Array.isArray(nextCandidates)) {
        for (const candidate of nextCandidates) {
          if (available.includes(candidate)) {
            return candidate;
          }
        }
        return null;
      }

      // If next is a single step name, return it if available
      if (typeof nextCandidates === 'string') {
        return available.includes(nextCandidates) ? nextCandidates : null;
      }

      // Fallback: use ordered steps
      const currentIndex = orderedSteps.indexOf(currentStep);
      for (let i = currentIndex + 1; i < orderedSteps.length; i++) {
        const step = orderedSteps[i];
        if (available.includes(step)) {
          return step;
        }
      }
      return null;
    },

    findNextAvailable: () => null as WizardStep<S, D[S], C, S, D> | null,

    findPrevAvailableName: (from?: S) => {
      const currentStep = from || store.state.step;
      const currentIndex = orderedSteps.indexOf(currentStep);

      for (let i = currentIndex - 1; i >= 0; i--) {
        const step = orderedSteps[i];
        if (helpers.availableStepNames().includes(step)) {
          return step;
        }
      }
      return null;
    },

    findPrevAvailable: () => null as WizardStep<S, D[S], C, S, D> | null,

    jumpToNextRequired: () => {
      const remaining = helpers.remainingSteps();
      const nextRequired = remaining.find(step => helpers.isRequired(step.name));
      return nextRequired || null;
    },

    jumpToNextRequiredName: () => {
      const remaining = helpers.remainingStepNames();
      const nextRequired = remaining.find(stepName => helpers.isRequired(stepName));
      return nextRequired || null;
    },

    isReachable: (step: S) => {
      // Simple reachability: step is in available steps or already completed
      return helpers.availableStepNames().includes(step) || helpers.completedStepNames().includes(step);
    },

    prerequisitesFor: (step: S) => {
      // Simple prerequisite logic: all steps before this one in order
      const stepIndex = orderedSteps.indexOf(step);
      return orderedSteps.slice(0, stepIndex);
    },

    successorsOf: (step: S) => {
      // Simple successor logic: all steps after this one in order
      const stepIndex = orderedSteps.indexOf(step);
      return orderedSteps.slice(stepIndex + 1);
    },

    stepAttempts: (step: S) => {
      return store.state.runtime?.[step]?.attempts ?? 0;
    },

    stepDuration: (step: S) => {
      const runtime = store.state.runtime?.[step];
      if (runtime?.startedAt && runtime?.finishedAt) {
        return runtime.finishedAt - runtime.startedAt;
      }
      return null;
    },

    percentCompletePerStep: () => {
      const result = {} as Record<S, number>;
      for (const step of orderedSteps) {
        if (helpers.completedStepNames().includes(step)) {
          result[step] = 100;
        } else if (step === store.state.step) {
          result[step] = 50; // Current step is 50% complete
        } else {
          result[step] = 0;
        }
      }
      return result;
    },

    snapshot: () => store.state,
  };

  // Wizard implementation
  const wizard: Wizard<C, S, D, E> = {
    store,

    // ===== Exposed Store State Properties =====
    get step(): S {
      return store.state.step;
    },

    get context(): Readonly<C> {
      return store.state.context;
    },

    get data(): Partial<D> {
      return store.state.data;
    },

    get meta() {
      return store.state.meta;
    },

    get errors(): Partial<Record<S, unknown>> {
      return store.state.errors;
    },

    get history(): Array<{ step: S; context: C; data: Partial<D> }> {
      return store.state.history;
    },

    get isLoading(): boolean {
      return store.state.isLoading;
    },

    get isTransitioning(): boolean {
      return store.state.isTransitioning;
    },

    get runtime() {
      return store.state.runtime;
    },

    reset() {
      store.setState({
        step: orderedSteps[0],
        context: structuredClone(initialContext),
        data: {} as Partial<D>,
        meta: initialMeta,
        errors: {},
        history: [],
        isLoading: false,
        isTransitioning: false,
        runtime: {},
      });
    },

    updateContext(fn: (context: C) => void) {
      store.setState(state => {
        const newContext = structuredClone(state.context);
        fn(newContext);
        return { ...state, context: newContext };
      });
    },

    setStepData<K extends S>(step: K, data: D[K]) {
      store.setState(state => ({
        ...state,
        data: { ...state.data, [step]: data },
      }));
    },

    updateStepData<K extends S>(step: K, updater: Partial<D[K]> | ((current: D[K] | undefined) => Partial<D[K]>)) {
      store.setState(state => {
        const currentData = state.data[step] as D[K] | undefined;
        const updates = typeof updater === 'function' ? updater(currentData) : updater;
        const newData = { ...(currentData || {} as any), ...updates } as D[K];
        return {
          ...state,
          data: { ...state.data, [step]: newData },
        };
      });
    },

    getStepData<K extends S>(step: K): D[K] | undefined {
      return store.state.data[step] as D[K] | undefined;
    },

    setStepMeta<K extends S>(step: K, meta: import('./types').StepMetaCore<C, S, D[K], never>) {
      store.setState(state => ({
        ...state,
        meta: { ...state.meta, [step]: meta },
      }));
    },

    updateStepMeta<K extends S>(step: K, updater: Partial<import('./types').StepMetaCore<C, S, D[K], never>> | ((current: import('./types').StepMetaCore<C, S, D[K], never> | undefined) => Partial<import('./types').StepMetaCore<C, S, D[K], never>>)) {
      store.setState(state => {
        const currentMeta = state.meta[step] as import('./types').StepMetaCore<C, S, D[K], never> | undefined;
        const updates = typeof updater === 'function' ? updater(currentMeta) : updater;
        const newMeta = { ...(currentMeta || {} as any), ...updates } as import('./types').StepMetaCore<C, S, D[K], never>;
        return {
          ...state,
          meta: { ...state.meta, [step]: newMeta },
        };
      });
    },

    getStepMeta<K extends S>(step: K): import('./types').StepMetaCore<C, S, D[K], never> | undefined {
      return store.state.meta[step] as import('./types').StepMetaCore<C, S, D[K], never> | undefined;
    },

    getStepError<K extends S>(step: K): unknown {
      return store.state.errors[step];
    },

    getAllErrors(): Partial<Record<S, unknown>> {
      return store.state.errors;
    },

    clearStepError<K extends S>(step: K): void {
      store.setState(state => {
        const newErrors = { ...state.errors };
        delete newErrors[step];
        return { ...state, errors: newErrors };
      });
    },

    clearAllErrors(): void {
      store.setState(state => ({ ...state, errors: {} }));
    },

    getContext: () => store.state.context,

    getCurrent: () => ({
      step: store.state.step,
      data: store.state.data[store.state.step] as D[S] | undefined,
      context: store.state.context,
    }),



    // ===== Enhanced Wizard API Methods =====

    // Enhanced step access methods
    getStep<K extends S>(step: K): WizardStep<K, D[K], C, S, D> {
      const stepData = store.state.data[step] as D[K] | undefined;
      return createStepWrapper(wizard, step, stepData, store.state.context);
    },

    getCurrentStep(): WizardStep<S, D[S], C, S, D> {
      return createCurrentStepWrapper(wizard);
    },

    // Enhanced navigation methods that return step objects
    async next(args?: { data?: D[S] }): Promise<WizardStep<S, D[S], C, S, D>> {
      const currentStep = store.state.step;

      // Set step data if provided
      if (args?.data) {
        store.setState(state => ({
          ...state,
          data: { ...state.data, [currentStep]: args.data },
        }));
      }

      // Validate current step before leaving
      const currentStepDef = steps[currentStep];
      if (currentStepDef.validate) {
        const currentData = store.state.data[currentStep];
        try {
          currentStepDef.validate({
            context: store.state.context,
            data: currentData as any,
          });
        } catch (err) {
          // Mark step as error and store the error
          updateRuntime(currentStep, { status: 'error' });
          store.setState(state => ({
            ...state,
            errors: { ...state.errors, [currentStep]: err },
          }));
          throw err;
        }
      }

      // Execute beforeExit BEFORE finding next step, so context updates are available for canEnter checks
      if (currentStepDef.beforeExit) {
        const currentData = store.state.data[currentStep];
        const exitArgs = {
          ...createStepArgs(currentStep, currentData),
          to: undefined, // We don't know the target yet
        };
        await currentStepDef.beforeExit(exitArgs);
      }

      // Find next step (now with updated context from beforeExit)
      const nextStep = helpers.findNextAvailableName();
      if (!nextStep) {
        throw new Error('No next step available');
      }

      // Transition to next step (beforeExit already executed above)
      await wizard.goTo(nextStep, { skipBeforeExit: true } as any);

      // Return step wrapper for the new current step
      return createCurrentStepWrapper(wizard) as WizardStep<S, D[S], C, S, D>;
    },

    async goTo<K extends S>(step: K, args?: { data?: D[K]; skipBeforeExit?: boolean; skipGuards?: boolean }): Promise<WizardStep<K, D[K], C, S, D>> {
      // Skip guard checks if requested (e.g., for browser history navigation)
      if (!args?.skipGuards && !helpers.canGoTo(step)) {
        throw new Error(`Cannot go to step: ${step}`);
      }

      const currentStep = store.state.step;

      // Set transitioning state
      store.setState(state => ({ ...state, isTransitioning: true }));

      try {
        // Set step data if provided
        if (args?.data) {
          store.setState(state => ({
            ...state,
            data: { ...state.data, [step]: args.data },
          }));
        }

        // Execute beforeExit on current step if defined (unless skipped)
        const currentStepDef = steps[currentStep];
        if (currentStepDef.beforeExit && !args?.skipBeforeExit && !args?.skipGuards) {
          const currentData = store.state.data[currentStep];
          const exitArgs = {
            ...createStepArgs(currentStep, currentData),
            to: step,
          };
          await currentStepDef.beforeExit(exitArgs);
        }

        // Save to history
        store.setState(state => ({
          ...state,
          history: [
            ...state.history,
            { step: currentStep, context: state.context, data: state.data },
          ].slice(-10), // Keep last 10 entries
        }));

        // Execute beforeEnter if defined (unless guards are skipped)
        const stepDef = steps[step];
        if (stepDef.beforeEnter && !args?.skipGuards) {
          const currentData = store.state.data[step] as D[K] | undefined;
          const stepArgs = createStepArgs(step, currentData);
          const enterArgs = { ...stepArgs, from: currentStep };

          const result = await stepDef.beforeEnter(enterArgs);
          if (result !== undefined) {
            const mergedData = typeof result === 'object' && result !== null
              ? { ...(currentData || {}), ...result } as D[K]
              : result as D[K];

            store.setState(state => ({
              ...state,
              data: { ...state.data, [step]: mergedData },
            }));
          }
        }

        // Update current step
        store.setState(state => ({ ...state, step }));

        // Return step wrapper for the target step
        const stepData = store.state.data[step] as D[K] | undefined;
        return createStepWrapper(wizard, step, stepData, store.state.context);
      } finally {
        // Clear transitioning state
        store.setState(state => ({ ...state, isTransitioning: false }));
      }
    },

    async back(): Promise<WizardStep<S, D[S], C, S, D>> {
      const history = store.state.history;
      if (history.length === 0) {
        throw new Error('No previous step in history');
      }

      const previousState = history[history.length - 1];

      // Set transitioning state
      store.setState(state => ({ ...state, isTransitioning: true }));

      try {
        // Restore previous state
        store.setState(state => ({
          ...state,
          step: previousState.step,
          context: previousState.context,
          data: previousState.data,
          history: history.slice(0, -1),
        }));

        // Return step wrapper for the restored step
        return createCurrentStepWrapper(wizard) as WizardStep<S, D[S], C, S, D>;
      } finally {
        // Clear transitioning state
        store.setState(state => ({ ...state, isTransitioning: false }));
      }
    },

    // Enhanced mark methods that return step objects
    markIdle<K extends S>(step: K): WizardStep<K, D[K], C, S, D> {
      updateRuntime(step, { status: undefined });
      const stepData = store.state.data[step] as D[K] | undefined;
      return createStepWrapper(wizard, step, stepData, store.state.context);
    },

    markLoading<K extends S>(step: K): WizardStep<K, D[K], C, S, D> {
      updateRuntime(step, { status: 'loading' });
      const stepData = store.state.data[step] as D[K] | undefined;
      return createStepWrapper(wizard, step, stepData, store.state.context);
    },

    markSkipped<K extends S>(step: K): WizardStep<K, D[K], C, S, D> {
      updateRuntime(step, { status: 'skipped' });
      const stepData = store.state.data[step] as D[K] | undefined;
      return createStepWrapper(wizard, step, stepData, store.state.context);
    },

    markError<K extends S>(step: K, err: unknown): WizardStep<K, D[K], C, S, D> {
      store.setState(state => ({
        ...state,
        errors: { ...state.errors, [step]: err },
      }));
      updateRuntime(step, { status: 'error' });
      const stepData = store.state.data[step] as D[K] | undefined;
      return createStepWrapper(wizard, step, stepData, store.state.context);
    },

    markTerminated<K extends S>(step: K, err?: unknown): WizardStep<K, D[K], C, S, D> {
      if (err) {
        store.setState(state => ({
          ...state,
          errors: { ...state.errors, [step]: err },
        }));
      }
      updateRuntime(step, { status: 'terminated' });
      const stepData = store.state.data[step] as D[K] | undefined;
      return createStepWrapper(wizard, step, stepData, store.state.context);
    },

    helpers,
  };

  // Initialize availability cache
  helpers.refreshAvailability();

  // Now that wizard is defined, update the object-returning helper methods
  helpers.allSteps = () => {
    return helpers.allStepNames().map(name => wizard.getStep(name));
  };

  helpers.orderedSteps = () => {
    return helpers.orderedStepNames().map(name => wizard.getStep(name));
  };

  helpers.availableSteps = () => {
    return helpers.availableStepNames().map(name => wizard.getStep(name));
  };

  helpers.unavailableSteps = () => {
    return helpers.unavailableStepNames().map(name => wizard.getStep(name));
  };

  helpers.completedSteps = () => {
    return helpers.completedStepNames().map(name => wizard.getStep(name));
  };

  helpers.remainingSteps = () => {
    return helpers.remainingStepNames().map(name => wizard.getStep(name));
  };

  helpers.firstIncompleteStep = () => {
    const name = helpers.firstIncompleteStepName();
    return name ? wizard.getStep(name) : null;
  };

  helpers.lastCompletedStep = () => {
    const name = helpers.lastCompletedStepName();
    return name ? wizard.getStep(name) : null;
  };

  helpers.findNextAvailable = (from?: S) => {
    const name = helpers.findNextAvailableName(from);
    return name ? wizard.getStep(name) : null;
  };

  helpers.findPrevAvailable = (from?: S) => {
    const name = helpers.findPrevAvailableName(from);
    return name ? wizard.getStep(name) : null;
  };

  helpers.jumpToNextRequired = () => {
    const name = helpers.jumpToNextRequiredName();
    return name ? wizard.getStep(name) : null;
  };

  return wizard;
}