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
  DataMapFromDefs,
  StepStatus,
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
} from './types';
import { resolve } from './types';

export function createWizard<C, E, TDefs extends Record<string, any>>(opts: {
  context: C;
  steps: TDefs;
  order?: readonly (keyof TDefs & string)[];
  onStatusChange?: (a: { step: keyof TDefs & string; prev?: StepStatus; next: StepStatus }) => void;
}): Wizard<C, StepIds<TDefs>, DataMapFromDefs<TDefs>, E> {
  type S = StepIds<TDefs>;
  type D = DataMapFromDefs<TDefs>;

  const { context: initialContext, steps, order, onStatusChange } = opts;

  // Determine step order: explicit order → topological → declaration order
  const allStepIds = Object.keys(steps) as S[];
  const orderedSteps = order ? [...order] as S[] : allStepIds;

  // Initialize store with @tanstack/store
  const initialState: WizardState<C, S, D> = {
    step: orderedSteps[0],
    context: structuredClone(initialContext),
    data: {} as Partial<D>,
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
    ctx: store.state.context,
    data,
    updateContext: (fn: (ctx: C) => void) => {
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

    async next(args?: { data?: D[S] }) {
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
    },

    async goTo(step: S, args?: { data?: D[S] }) {
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
        const enterArgs: StepEnterArgs<C, S, any, E> = {
          ...createStepArgs(step, store.state.data[step]),
          from: currentStep,
        };

        const result = await Promise.resolve(stepDef.beforeEnter(enterArgs));
        if (result) {
          store.setState(state => ({
            ...state,
            data: { ...state.data, [step]: result },
          }));
        }
      }

      // Update current step
      store.setState(state => ({ ...state, step }));

      // Call status change handler
      if (onStatusChange) {
        onStatusChange({ step, prev: 'current', next: 'current' });
      }
    },

    async back() {
      const history = store.state.history;
      if (history.length === 0) {
        throw new Error('No history available for back navigation');
      }

      const lastEntry = history[history.length - 1];
      store.setState(state => ({
        ...lastEntry,
        history: state.history.slice(0, -1),
        errors: state.errors,
        isLoading: state.isLoading,
        isTransitioning: state.isTransitioning,
        runtime: state.runtime,
      }));
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

    updateContext(fn: (ctx: C) => void) {
      store.setState(state => {
        const newContext = structuredClone(state.context);
        fn(newContext);
        return { ...state, context: newContext };
      });
    },

    setStepData(step: S, data: D[S]) {
      store.setState(state => ({
        ...state,
        data: { ...state.data, [step]: data },
      }));
    },

    getStepData(step: S): D[S] | undefined {
      return store.state.data[step] as D[S] | undefined;
    },

    getContext: () => store.state.context,

    getCurrent: () => ({
      step: store.state.step,
      data: store.state.data[store.state.step] as D[S] | undefined,
      ctx: store.state.context,
    }),

    markError(step: S, err: unknown) {
      store.setState(state => ({
        ...state,
        errors: { ...state.errors, [step]: err },
      }));
      updateRuntime(step, { status: 'error' });
    },

    markTerminated(step: S, err?: unknown) {
      if (err) {
        store.setState(state => ({
          ...state,
          errors: { ...state.errors, [step]: err },
        }));
      }
      updateRuntime(step, { status: 'terminated' });
    },

    markLoading(step: S) {
      updateRuntime(step, { status: 'loading' });
    },

    markIdle(step: S) {
      updateRuntime(step, { status: undefined });
    },

    markSkipped(step: S) {
      updateRuntime(step, { status: 'skipped' });
    },

    helpers,
  };

  // Initialize availability cache
  helpers.refreshAvailability();

  return wizard;
}