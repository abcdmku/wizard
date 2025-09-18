import { Store } from '@tanstack/store';
import type {
  Wizard,
  WizardConfig,
  WizardState,
  WizardTransitionEvent,
  StepStatus,
} from './types';
import { createHelpers } from './helpers';

/**
 * Creates a deeply type-safe wizard instance with advanced features.
 * Provides step management, status tracking, and extensive helper methods.
 * @template C - Global shared context type
 * @template S - Union of step IDs (string literals)
 * @template D - Per-step data map
 * @template E - Event types for orchestration
 * @param config - Wizard configuration object
 * @returns Wizard instance with all methods and helpers
 */
export function createWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(config: WizardConfig<C, S, D, E>): Wizard<C, S, D, E> {
  const {
    initialStep,
    initialContext,
    steps,
    onTransition,
    persistence,
    keepHistory = true,
    maxHistorySize = 10,
  } = config;

  // Event listeners
  const eventListeners = new Set<(event: E) => void>();

  // Initialize state
  const initialState: WizardState<C, S, D> = {
    step: initialStep,
    context: structuredClone(initialContext),
    data: {} as Partial<D>,
    errors: {},
    history: [],
    isLoading: false,
    isTransitioning: false,
    runtime: {},
  };

  // Create reactive store
  const store = new Store<WizardState<C, S, D>>(initialState);

  // Create helpers (cast to remove E type parameter issue)
  const helpers = createHelpers(config as WizardConfig<C, S, D>, store);

  // Load persisted state if available
  if (persistence?.load) {
    Promise.resolve(persistence.load()).then((savedState) => {
      if (savedState) {
        store.setState(() => savedState);
      }
    });
  }

  // Helper to save state
  const saveState = () => {
    if (persistence?.save) {
      const state = store.state;
      Promise.resolve(persistence.save(state));
    }
  };

  // Helper to update state and save
  const updateState = (updater: (state: WizardState<C, S, D>) => WizardState<C, S, D>) => {
    store.setState(updater);
    saveState();
  };

  // Helper to clone context for safe mutation
  const cloneContext = (ctx: C): C => {
    return structuredClone(ctx);
  };

  // Update context with mutable draft pattern
  const updateContext = (updater: (ctx: C) => void) => {
    updateState((state) => {
      const draft = cloneContext(state.context);
      updater(draft);
      return {
        ...state,
        context: draft,
      };
    });
  };

  // Set data for a specific step
  const setStepData = (step: S, data: D[S]) => {
    updateState((state) => {
      const newData = {
        ...state.data,
        [step]: data,
      };
      const newErrors = state.errors[step]
        ? { ...state.errors, [step]: undefined }
        : state.errors;
      return {
        ...state,
        data: newData,
        errors: newErrors,
      };
    });
  };

  // Get current context (readonly)
  const getContext = (): Readonly<C> => {
    return store.state.context;
  };

  // Get current step info
  const getCurrent = () => {
    const state = store.state;
    return {
      step: state.step,
      data: state.data[state.step] as Readonly<D[S]> | undefined,
      ctx: state.context as Readonly<C>,
    };
  };

  // Emit custom event
  const emit = (event: E) => {
    eventListeners.forEach((listener) => listener(event));
  };

  // Add to history
  const pushHistory = () => {
    if (!keepHistory) return;
    
    updateState((state) => {
      const historyEntry = {
        step: state.step,
        context: cloneContext(state.context),
        data: structuredClone(state.data),
      };
      
      return {
        ...state,
        history: [
          ...state.history.slice(-(maxHistorySize - 1)),
          historyEntry,
        ],
      };
    });
  };

  // Validate step data
  const validateStepData = async (
    step: S,
    data: unknown
  ): Promise<{ valid: boolean; error?: unknown }> => {
    const stepDef = steps[step];
    if (!stepDef.validate) {
      return { valid: true };
    }

    try {
      const validator: typeof stepDef.validate = stepDef.validate;
      validator(data, getContext());
      return { valid: true };
    } catch (error) {
      return { valid: false, error };
    }
  };

  // Check if can enter step
  const canEnterStep = async (step: S): Promise<boolean> => {
    const stepDef = steps[step];
    if (!stepDef.canEnter) {
      return true;
    }

    const result = await stepDef.canEnter({ ctx: getContext() });
    return result;
  };

  // Check if can exit current step
  const canExitStep = async (): Promise<boolean> => {
    const state = store.state;
    const stepDef = steps[state.step];
    if (!stepDef.canExit) {
      return true;
    }

    const data = state.data[state.step] || ({} as D[S]);
    const result = await stepDef.canExit({ 
      ctx: getContext(), 
      data: data as Readonly<D[S]> 
    });
    return result;
  };

  // Execute beforeExit hook
  const executeBeforeExit = async () => {
    const state = store.state;
    const stepDef = steps[state.step];
    if (!stepDef.beforeExit) {
      return;
    }

    const data = state.data[state.step] || ({} as D[S]);
    await stepDef.beforeExit({
      ctx: getContext(),
      data: data as Readonly<D[S]>,
      updateContext,
      emit,
    });
  };

  // Execute load hook
  const executeLoad = async (step: S) => {
    const stepDef = steps[step];
    if (!stepDef.load) {
      return;
    }

    updateState((state) => ({
      ...state,
      isLoading: true,
    }));

    try {
      await stepDef.load({
        ctx: getContext(),
        setStepData: (data) => setStepData(step, data),
        updateContext,
      });
    } finally {
      updateState((state) => ({
        ...state,
        isLoading: false,
      }));
    }
  };

  // Get allowed next steps
  const getNextSteps = (): S[] => {
    const state = store.state;
    const stepDef = steps[state.step];
    const data = state.data[state.step] || ({} as D[S]);

    if (typeof stepDef.next === 'function') {
      const result = stepDef.next({ 
        ctx: getContext(), 
        data: data as Readonly<D[S]> 
      });
      return Array.isArray(result) ? [...result] as S[] : [result as S];
    }

    return [...stepDef.next];
  };

  // Mark methods
  const markError = (step: S, err: unknown) => {
    updateState((state) => ({
      ...state,
      runtime: {
        ...state.runtime,
        [step]: {
          ...state.runtime?.[step],
          status: 'error' as StepStatus,
        },
      },
      errors: {
        ...state.errors,
        [step]: err,
      },
    }));
    if (config.onStatusChange) {
      config.onStatusChange({ step, prev: undefined, next: 'error' });
    }
  };

  const markTerminated = (step: S, err?: unknown) => {
    updateState((state) => ({
      ...state,
      runtime: {
        ...state.runtime,
        [step]: {
          ...state.runtime?.[step],
          status: 'terminated' as StepStatus,
        },
      },
      errors: err ? {
        ...state.errors,
        [step]: err,
      } : state.errors,
    }));
    if (config.onStatusChange) {
      config.onStatusChange({ step, prev: undefined, next: 'terminated' });
    }
  };

  const markLoading = (step: S) => {
    updateState((state) => ({
      ...state,
      runtime: {
        ...state.runtime,
        [step]: {
          ...state.runtime?.[step],
          status: 'loading' as StepStatus,
        },
      },
    }));
    if (config.onStatusChange) {
      config.onStatusChange({ step, prev: undefined, next: 'loading' });
    }
  };

  const markIdle = (step: S) => {
    updateState((state) => {
      const newRuntime = { ...state.runtime } as typeof state.runtime;
      if (newRuntime && newRuntime[step]) {
        const { status, ...rest } = newRuntime[step]!;
        newRuntime[step] = rest;
      }
      return {
        ...state,
        runtime: newRuntime,
      };
    });
  };

  const markSkipped = (step: S) => {
    updateState((state) => ({
      ...state,
      runtime: {
        ...state.runtime,
        [step]: {
          ...state.runtime?.[step],
          status: 'skipped' as StepStatus,
        },
      },
    }));
    if (config.onStatusChange) {
      config.onStatusChange({ step, prev: undefined, next: 'skipped' });
    }
  };

  // Transition to a new step
  const transitionTo = async (
    targetStep: S,
    data?: D[S],
    transitionType: 'next' | 'back' | 'goto' = 'goto'
  ) => {
    const currentState = store.state;
    const fromStep = currentState.step;

    // Set transitioning flag
    updateState((state) => ({
      ...state,
      isTransitioning: true,
    }));

    try {
      // If data provided, validate and set it
      if (data !== undefined) {
        const validation = await validateStepData(fromStep, data);
        if (!validation.valid) {
          updateState((state) => ({
            ...state,
            errors: {
              ...state.errors,
              [fromStep]: validation.error,
            },
            isTransitioning: false,
          }));
          throw new Error(`Validation failed for step ${fromStep}`);
        }
        setStepData(fromStep, data);
      }

      // Check if can exit current step
      const canExit = await canExitStep();
      if (!canExit) {
        updateState((state) => ({
          ...state,
          isTransitioning: false,
        }));
        throw new Error(`Cannot exit step ${fromStep}`);
      }

      // Execute beforeExit hook
      await executeBeforeExit();

      // Check if can enter target step
      const canEnter = await canEnterStep(targetStep);
      if (!canEnter) {
        updateState((state) => ({
          ...state,
          isTransitioning: false,
        }));
        throw new Error(`Cannot enter step ${targetStep}`);
      }

      // Save current state to history before transitioning
      if (transitionType !== 'back') {
        pushHistory();
      }

      // Update step with runtime tracking
      updateState((state) => ({
        ...state,
        step: targetStep,
        isTransitioning: false,
        runtime: {
          ...state.runtime,
          [targetStep]: {
            ...(state.runtime?.[targetStep] || {}),
            startedAt: Date.now(),
            attempts: ((state.runtime?.[targetStep]?.attempts) ?? 0) + 1,
          },
        },
      }));

      // Execute load hook for new step
      await executeLoad(targetStep);

      // Fire transition event
      if (onTransition) {
        const event: WizardTransitionEvent<C, S, D, E> = {
          from: fromStep,
          to: targetStep,
          context: getContext(),
          data: store.state.data,
          type: transitionType,
        };
        await onTransition(event);
      }
    } catch (error) {
      updateState((state) => ({
        ...state,
        isTransitioning: false,
      }));
      throw error;
    }
  };

  // Go to next step
  const next = async (args?: { data?: D[S] }) => {
    const nextSteps = getNextSteps();
    if (nextSteps.length === 0) {
      throw new Error('No next step available');
    }
    await transitionTo(nextSteps[0], args?.data, 'next');
  };

  // Go to specific step
  const goTo = async (step: S, args?: { data?: D[S] }) => {
    await transitionTo(step, args?.data, 'goto');
  };

  // Go back to previous step
  const back = async () => {
    const state = store.state;
    if (!keepHistory || state.history.length === 0) {
      throw new Error('No history available to go back');
    }

    const previousState = state.history[state.history.length - 1];
    
    updateState((s) => ({
      ...s,
      step: previousState.step,
      context: previousState.context,
      data: previousState.data,
      history: s.history.slice(0, -1),
    }));

    // Execute load hook for restored step
    await executeLoad(previousState.step);

    // Fire transition event
    if (onTransition) {
      const event: WizardTransitionEvent<C, S, D, E> = {
        from: state.step,
        to: previousState.step,
        context: getContext(),
        data: store.state.data,
        type: 'back',
      };
      await onTransition(event);
    }
  };

  // Reset wizard
  const reset = () => {
    updateState(() => ({
      step: initialStep,
      context: cloneContext(initialContext),
      data: {} as Partial<D>,
      errors: {},
      history: [],
      isLoading: false,
      isTransitioning: false,
      runtime: {},
    }));

    if (persistence?.clear) {
      persistence.clear();
    }
  };

  // Subscribe to state changes
  const subscribe = (cb: (state: WizardState<C, S, D>) => void) => {
    return store.subscribe(() => {
      cb(store.state);
    });
  };

  // Get state snapshot
  const snapshot = (): WizardState<C, S, D> => {
    return structuredClone(store.state);
  };

  // Restore from snapshot
  const restore = (snap: WizardState<C, S, D>) => {
    updateState(() => snap);
  };

  // Destroy wizard
  const destroy = () => {
    eventListeners.clear();
  };

  return {
    store,
    next,
    goTo,
    back,
    reset,
    updateContext,
    setStepData,
    getContext,
    getCurrent,
    subscribe,
    emit,
    snapshot,
    restore,
    destroy,
    markError,
    markTerminated,
    markLoading,
    markIdle,
    markSkipped,
    helpers,
  };
}