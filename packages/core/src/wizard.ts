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
  for (const stepName of allStepIds) {
    const stepDef = steps[stepName];
    if (stepDef.data !== undefined) {
      initialData[stepName as keyof D] = stepDef.data as D[keyof D];
    }
  }

  // Initialize store with @tanstack/store
  const initialState: WizardState<C, S, D> = {
    step: orderedSteps[0],
    context: structuredClone(initialContext),
    data: initialData,
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
    allSteps: () => allStepIds,
    orderedSteps: () => orderedSteps,
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

    availableSteps: () => {
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

    unavailableSteps: () => {
      return orderedSteps.filter(step => !helpers.availableSteps().includes(step));
    },

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

    completedSteps: () => {
      return orderedSteps.filter(step => {
        const stepDef = steps[step];
        if (stepDef.complete) {
          const args = createStepArgs(step, store.state.data[step]);
          return resolve(stepDef.complete, args);
        }
        return store.state.data[step] !== undefined;
      });
    },

    remainingSteps: () => {
      const completed = helpers.completedSteps();
      return orderedSteps.filter(step => !completed.includes(step));
    },

    firstIncompleteStep: () => {
      const remaining = helpers.remainingSteps();
      return remaining.length > 0 ? remaining[0] : null;
    },

    lastCompletedStep: () => {
      const completed = helpers.completedSteps();
      return completed.length > 0 ? completed[completed.length - 1] : null;
    },

    remainingRequiredCount: () => {
      return helpers.remainingSteps().filter(step => helpers.isRequired(step)).length;
    },

    isComplete: () => {
      return helpers.remainingRequiredCount() === 0;
    },

    progress: () => {
      const total = orderedSteps.filter(step => helpers.isRequired(step)).length;
      const completed = helpers.completedSteps().filter(step => helpers.isRequired(step)).length;
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

      return helpers.findNextAvailable() !== null;
    },

    canGoBack: () => {
      return store.state.history.length > 0;
    },

    canGoTo: (step: S) => {
      return helpers.availableSteps().includes(step);
    },

    findNextAvailable: (from?: S) => {
      const currentStep = from || store.state.step;
      const currentIndex = orderedSteps.indexOf(currentStep);

      for (let i = currentIndex + 1; i < orderedSteps.length; i++) {
        const step = orderedSteps[i];
        if (helpers.availableSteps().includes(step)) {
          return step;
        }
      }
      return null;
    },

    findPrevAvailable: (from?: S) => {
      const currentStep = from || store.state.step;
      const currentIndex = orderedSteps.indexOf(currentStep);

      for (let i = currentIndex - 1; i >= 0; i--) {
        const step = orderedSteps[i];
        if (helpers.availableSteps().includes(step)) {
          return step;
        }
      }
      return null;
    },

    jumpToNextRequired: () => {
      const remaining = helpers.remainingSteps();
      const nextRequired = remaining.find(step => helpers.isRequired(step));
      return nextRequired || null;
    },

    isReachable: (step: S) => {
      // Simple reachability: step is in available steps or already completed
      return helpers.availableSteps().includes(step) || helpers.completedSteps().includes(step);
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
        if (helpers.completedSteps().includes(step)) {
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
    async next(args?: { data?: D[S] }): Promise<WizardStep<S, unknown, C, S, D>> {
      const currentStep = store.state.step;

      // Set step data if provided
      if (args?.data) {
        store.setState(state => ({
          ...state,
          data: { ...state.data, [currentStep]: args.data },
        }));
      }

      // Find next step
      const nextStep = helpers.findNextAvailable();
      if (!nextStep) {
        throw new Error('No next step available');
      }

      // Transition to next step
      await wizard.goTo(nextStep);

      // Return step wrapper for the new current step
      return createCurrentStepWrapper(wizard);
    },

    async goTo<K extends S>(step: K, args?: { data?: D[K] }): Promise<WizardStep<K, D[K], C, S, D>> {
      if (!helpers.canGoTo(step)) {
        throw new Error(`Cannot go to step: ${step}`);
      }

      const currentStep = store.state.step;

      // Set step data if provided
      if (args?.data) {
        store.setState(state => ({
          ...state,
          data: { ...state.data, [step]: args.data },
        }));
      }

      // Save to history
      store.setState(state => ({
        ...state,
        history: [
          ...state.history,
          { step: currentStep, context: state.context, data: state.data },
        ].slice(-10), // Keep last 10 entries
      }));

      // Execute beforeEnter if defined
      const stepDef = steps[step];
      if (stepDef.beforeEnter) {
        const currentData = store.state.data[step] as D[K] | undefined;
        const args = createStepArgs(step, currentData);
        const enterArgs = { ...args, from: currentStep };

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
    },

    async back(): Promise<WizardStep<S, unknown, C, S, D>> {
      const history = store.state.history;
      if (history.length === 0) {
        throw new Error('No previous step in history');
      }

      const previousState = history[history.length - 1];

      // Restore previous state
      store.setState(state => ({
        ...state,
        step: previousState.step,
        context: previousState.context,
        data: previousState.data,
        history: history.slice(0, -1),
      }));

      // Return step wrapper for the restored step
      return createCurrentStepWrapper(wizard);
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

  return wizard;
}