import type {
  Wizard,
  WizardConfig,
  WizardState,
  WizardTransitionEvent,
  InferContext,
  InferSteps,
  InferDataMap,
} from '../types';
import { createHelpers } from '../helpers';
import { createStateManager } from './stateManager';
import { createContextManager } from './contextManager';
import { createHistoryManager } from './history';
import { createStatusMarkers } from './runtimeMarkers';
import { createStepLifecycle } from './stepLifecycle';
import { createTransitionController } from './transitionController';

// Overload 1: Explicit types (backward compatible)
export function createWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(config: WizardConfig<C, S, D, E>): Wizard<C, S, D, E>;

// Overload 2: Inferred types
export function createWizard<
  T extends {
    initialStep: string;
    initialContext?: any;
    steps: Record<string, any>;
  }
>(config: T): Wizard<
  InferContext<T>,
  InferSteps<T>,
  InferDataMap<T>,
  never
>;

// Implementation
export function createWizard(config: any): any {
  const {
    initialStep,
    initialContext = {},
    persistence,
    keepHistory = true,
    maxHistorySize = 10,
  } = config;

  const initialState: WizardState<any, any, any> = {
    step: initialStep,
    context: structuredClone(initialContext),
    data: {} as Partial<any>,
    errors: {},
    history: [],
    isLoading: false,
    isTransitioning: false,
    runtime: {},
  };

  const stateManager = createStateManager(initialState, persistence);
  stateManager.loadPersistedState();

  const contextManager = createContextManager(stateManager);
  const historyManager = createHistoryManager(
    stateManager,
    { keepHistory, maxHistorySize },
    contextManager.cloneContext
  );
  const statusMarkers = createStatusMarkers(config, stateManager);

  const eventListeners = new Set<(event: any) => void>();
  const emit = (event: any) => {
    for (const listener of eventListeners) {
      listener(event);
    }
  };

  const lifecycle = createStepLifecycle(config, stateManager, contextManager, emit);

  const onTransition = config.onTransition
    ? async (event: WizardTransitionEvent<any, any, any, any>) => {
        await config.onTransition!(event);
      }
    : undefined;

  const transitions = createTransitionController({
    state: stateManager,
    context: contextManager,
    history: historyManager,
    lifecycle,
    onTransition,
  });

  const helpers = createHelpers(config, stateManager.store);

  const reset = () => {
    stateManager.replace({
      step: initialStep,
      context: contextManager.cloneContext(initialContext),
      data: {} as Partial<any>,
      errors: {},
      history: [],
      isLoading: false,
      isTransitioning: false,
      runtime: {},
    });

    stateManager.clearPersistence();
  };

  const subscribe = (listener: (state: WizardState<any, any, any>) => void) => {
    return stateManager.subscribe(listener);
  };

  const getStepData = (step: any): any | undefined => {
    return stateManager.store.state.data[step];
  };

  return {
    store: stateManager.store,
    next: transitions.next,
    goTo: transitions.goTo,
    back: transitions.back,
    reset,
    updateContext: contextManager.updateContext,
    setStepData: contextManager.setStepData,
    getContext: contextManager.getContext,
    getCurrent: contextManager.getCurrent,
    getStepData,
    subscribe,
    emit,
    snapshot: stateManager.snapshot,
    restore: stateManager.restore,
    destroy: () => {
      eventListeners.clear();
    },
    markError: statusMarkers.markError,
    markTerminated: statusMarkers.markTerminated,
    markLoading: statusMarkers.markLoading,
    markIdle: statusMarkers.markIdle,
    markSkipped: statusMarkers.markSkipped,
    helpers,
  };
}




