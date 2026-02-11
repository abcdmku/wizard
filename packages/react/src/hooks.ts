import { useContext } from 'react';
import { useStore } from '@tanstack/react-store';
import type { Wizard, WizardState } from '@wizard/core';
import { WizardContext } from './context';
import type { ReactWizardStep, StepComponent } from './types';
import { wrapWithReactStep } from './step-wrapper';

type WizardWithComponents<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
> = Wizard<C, S, D, E> & {
  getStepComponent?: (stepName: S) => StepComponent<C, S, D, E, S> | undefined;
};

type BoundMethods<C, S extends string, D extends Record<S, unknown>, E> = {
  next: Wizard<C, S, D, E>['next'];
  back: Wizard<C, S, D, E>['back'];
  goTo: Wizard<C, S, D, E>['goTo'];
  reset: Wizard<C, S, D, E>['reset'];
  updateStepData: Wizard<C, S, D, E>['updateStepData'];
  setStepData: Wizard<C, S, D, E>['setStepData'];
  getStepData: Wizard<C, S, D, E>['getStepData'];
  updateContext: Wizard<C, S, D, E>['updateContext'];
  getContext: Wizard<C, S, D, E>['getContext'];
  setStepMeta: Wizard<C, S, D, E>['setStepMeta'];
  updateStepMeta: Wizard<C, S, D, E>['updateStepMeta'];
  getStepMeta: Wizard<C, S, D, E>['getStepMeta'];
  getStepError: Wizard<C, S, D, E>['getStepError'];
  getAllErrors: Wizard<C, S, D, E>['getAllErrors'];
  clearStepError: Wizard<C, S, D, E>['clearStepError'];
  clearAllErrors: Wizard<C, S, D, E>['clearAllErrors'];
  getStep: Wizard<C, S, D, E>['getStep'];
  getCurrentStep: Wizard<C, S, D, E>['getCurrentStep'];
  getCurrent: Wizard<C, S, D, E>['getCurrent'];
  markError: Wizard<C, S, D, E>['markError'];
  markTerminated: Wizard<C, S, D, E>['markTerminated'];
  markLoading: Wizard<C, S, D, E>['markLoading'];
  markIdle: Wizard<C, S, D, E>['markIdle'];
  markSkipped: Wizard<C, S, D, E>['markSkipped'];
};

const boundMethodCache = new WeakMap<
  Wizard<any, any, any, any>,
  BoundMethods<any, any, any, any>
>();

function getBoundMethods<C, S extends string, D extends Record<S, unknown>, E>(
  wizard: Wizard<C, S, D, E>
): BoundMethods<C, S, D, E> {
  const cached = boundMethodCache.get(wizard);
  if (cached) {
    return cached as BoundMethods<C, S, D, E>;
  }

  const methods: BoundMethods<C, S, D, E> = {
    next: wizard.next.bind(wizard),
    back: wizard.back.bind(wizard),
    goTo: wizard.goTo.bind(wizard),
    reset: wizard.reset.bind(wizard),
    updateStepData: wizard.updateStepData.bind(wizard),
    setStepData: wizard.setStepData.bind(wizard),
    getStepData: wizard.getStepData.bind(wizard),
    updateContext: wizard.updateContext.bind(wizard),
    getContext: wizard.getContext.bind(wizard),
    setStepMeta: wizard.setStepMeta.bind(wizard),
    updateStepMeta: wizard.updateStepMeta.bind(wizard),
    getStepMeta: wizard.getStepMeta.bind(wizard),
    getStepError: wizard.getStepError.bind(wizard),
    getAllErrors: wizard.getAllErrors.bind(wizard),
    clearStepError: wizard.clearStepError.bind(wizard),
    clearAllErrors: wizard.clearAllErrors.bind(wizard),
    getStep: wizard.getStep.bind(wizard),
    getCurrentStep: wizard.getCurrentStep.bind(wizard),
    getCurrent: wizard.getCurrent.bind(wizard),
    markError: wizard.markError.bind(wizard),
    markTerminated: wizard.markTerminated.bind(wizard),
    markLoading: wizard.markLoading.bind(wizard),
    markIdle: wizard.markIdle.bind(wizard),
    markSkipped: wizard.markSkipped.bind(wizard),
  };

  boundMethodCache.set(wizard, methods);
  return methods;
}

function useResolvedWizard<C, S extends string, D extends Record<S, unknown>, E>(
  wizard?: WizardWithComponents<C, S, D, E>
): WizardWithComponents<C, S, D, E> {
  const wizardFromContext = useContext(WizardContext) as
    | WizardWithComponents<C, S, D, E>
    | null;

  if (wizard) {
    return wizard;
  }

  if (!wizardFromContext) {
    throw new Error(
      'Wizard context not found. Pass a wizard instance or wrap with <WizardProvider>.'
    );
  }

  return wizardFromContext;
}

function getStepComponentGetter<C, S extends string, D extends Record<S, unknown>, E>(
  wizard: WizardWithComponents<C, S, D, E>
) {
  return (stepName: S) => wizard.getStepComponent?.(stepName);
}

type UseWizardReturn<C, S extends string, D extends Record<S, unknown>, E> = {
  step: S;
  currentStep: ReactWizardStep<S, D[S], C, S, D>;
  data: Partial<D>;
  context: C;
  meta: WizardState<C, S, D>['meta'];
  history: WizardState<C, S, D>['history'];
  visitedSteps: S[];
  runtime: WizardState<C, S, D>['runtime'];
  errors: WizardState<C, S, D>['errors'];
  isLoading: boolean;
  isTransitioning: boolean;
  helpers: Wizard<C, S, D, E>['helpers'];
  store: Wizard<C, S, D, E>['store'];
} & BoundMethods<C, S, D, E>;

export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: WizardWithComponents<C, S, D, E>): UseWizardReturn<C, S, D, E>;
export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(): UseWizardReturn<C, S, D, E>;
export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard?: WizardWithComponents<C, S, D, E>): UseWizardReturn<C, S, D, E> {
  const resolvedWizard = useResolvedWizard(wizard);
  const state = useStore(resolvedWizard.store);
  const currentStep = wrapWithReactStep(
    resolvedWizard.getCurrentStep(),
    getStepComponentGetter(resolvedWizard)
  );
  const methods = getBoundMethods(resolvedWizard);

  return {
    step: state.step,
    currentStep,
    data: state.data,
    context: state.context,
    meta: state.meta,
    history: state.history,
    visitedSteps: state.history.map((entry) => entry.step),
    runtime: state.runtime,
    errors: state.errors,
    isLoading: state.isLoading,
    isTransitioning: state.isTransitioning,
    helpers: resolvedWizard.helpers,
    store: resolvedWizard.store,
    ...methods,
  };
}

export function useCurrentStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: WizardWithComponents<C, S, D, E>): ReactWizardStep<S, D[S], C, S, D>;
export function useCurrentStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(): ReactWizardStep<S, D[S], C, S, D>;
export function useCurrentStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard?: WizardWithComponents<C, S, D, E>): ReactWizardStep<S, D[S], C, S, D> {
  const resolvedWizard = useResolvedWizard(wizard);
  useStore(resolvedWizard.store, (state) => state.step);
  return wrapWithReactStep(
    resolvedWizard.getCurrentStep(),
    getStepComponentGetter(resolvedWizard)
  );
}

export function useWizardStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  K extends S = S
>(
  wizard: WizardWithComponents<C, S, D, E>,
  stepName: K
): ReactWizardStep<K, D[K], C, S, D>;
export function useWizardStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  K extends S = S
>(stepName: K): ReactWizardStep<K, D[K], C, S, D>;
export function useWizardStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  K extends S = S
>(
  wizardOrStepName: WizardWithComponents<C, S, D, E> | K,
  maybeStepName?: K
): ReactWizardStep<K, D[K], C, S, D> {
  const hasWizardArg = typeof wizardOrStepName !== 'string';
  const resolvedWizard = useResolvedWizard(
    hasWizardArg ? (wizardOrStepName as WizardWithComponents<C, S, D, E>) : undefined
  );
  const stepName = (hasWizardArg ? maybeStepName : wizardOrStepName) as K | undefined;

  if (!stepName) {
    throw new Error('useWizardStep requires a step name.');
  }

  useStore(resolvedWizard.store, (state) => state.data[stepName]);
  useStore(resolvedWizard.store, (state) => state.runtime?.[stepName]?.status);
  useStore(resolvedWizard.store, (state) => state.errors[stepName]);

  return wrapWithReactStep(
    resolvedWizard.getStep(stepName),
    getStepComponentGetter(resolvedWizard)
  );
}

export function useWizardProgress<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(
  wizard: WizardWithComponents<C, S, D, E>
): {
  currentIndex: number;
  totalSteps: number;
  percentage: number;
  visitedSteps: S[];
  isFirstStep: boolean;
  isLastStep: boolean;
};
export function useWizardProgress<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(): {
  currentIndex: number;
  totalSteps: number;
  percentage: number;
  visitedSteps: S[];
  isFirstStep: boolean;
  isLastStep: boolean;
};
export function useWizardProgress<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(
  wizard?: WizardWithComponents<C, S, D, E>
): {
  currentIndex: number;
  totalSteps: number;
  percentage: number;
  visitedSteps: S[];
  isFirstStep: boolean;
  isLastStep: boolean;
} {
  const resolvedWizard = useResolvedWizard(wizard);
  const step = useStore(resolvedWizard.store, (state) => state.step);
  const visitedSteps = useStore(resolvedWizard.store, (state) =>
    state.history.map((entry) => entry.step)
  );
  useStore(resolvedWizard.store, (state) =>
    resolvedWizard.helpers
      .orderedStepNames()
      .map(
        (name) =>
          `${state.runtime?.[name]?.status ?? 'idle'}:${state.meta[name]?.hidden === true ? '1' : '0'}`
      )
      .join('|')
  );

  const snapshot = resolvedWizard.store.state;
  const allSteps = resolvedWizard.helpers.orderedStepNames();
  const visibleSteps = allSteps.filter(
    (name) =>
      snapshot.runtime?.[name]?.status !== 'terminated' &&
      snapshot.meta[name]?.hidden !== true
  );
  const currentIndex = visibleSteps.indexOf(step);
  const totalSteps = visibleSteps.length;
  const percentage = totalSteps > 0 ? ((currentIndex + 1) / totalSteps) * 100 : 0;

  return {
    currentIndex,
    totalSteps,
    percentage,
    visitedSteps,
    isFirstStep: currentIndex === 0,
    isLastStep: totalSteps > 0 && currentIndex === totalSteps - 1,
  };
}

export function useWizardActions<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: WizardWithComponents<C, S, D, E>): Pick<
  BoundMethods<C, S, D, E>,
  'next' | 'back' | 'goTo' | 'reset' | 'updateStepData' | 'setStepData' | 'updateContext'
>;
export function useWizardActions<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(): Pick<
  BoundMethods<C, S, D, E>,
  'next' | 'back' | 'goTo' | 'reset' | 'updateStepData' | 'setStepData' | 'updateContext'
>;
export function useWizardActions<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(
  wizard?: WizardWithComponents<C, S, D, E>
): Pick<
  BoundMethods<C, S, D, E>,
  'next' | 'back' | 'goTo' | 'reset' | 'updateStepData' | 'setStepData' | 'updateContext'
> {
  const resolvedWizard = useResolvedWizard(wizard);
  const methods = getBoundMethods(resolvedWizard);
  return {
    next: methods.next,
    back: methods.back,
    goTo: methods.goTo,
    reset: methods.reset,
    updateStepData: methods.updateStepData,
    setStepData: methods.setStepData,
    updateContext: methods.updateContext,
  };
}

export function useWizardHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: WizardWithComponents<C, S, D, E>): {
  helpers: Wizard<C, S, D, E>['helpers'];
  getStep: BoundMethods<C, S, D, E>['getStep'];
  getCurrentStep: BoundMethods<C, S, D, E>['getCurrentStep'];
  visitedSteps: S[];
  history: WizardState<C, S, D>['history'];
};
export function useWizardHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(): {
  helpers: Wizard<C, S, D, E>['helpers'];
  getStep: BoundMethods<C, S, D, E>['getStep'];
  getCurrentStep: BoundMethods<C, S, D, E>['getCurrentStep'];
  visitedSteps: S[];
  history: WizardState<C, S, D>['history'];
};
export function useWizardHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(
  wizard?: WizardWithComponents<C, S, D, E>
): {
  helpers: Wizard<C, S, D, E>['helpers'];
  getStep: BoundMethods<C, S, D, E>['getStep'];
  getCurrentStep: BoundMethods<C, S, D, E>['getCurrentStep'];
  visitedSteps: S[];
  history: WizardState<C, S, D>['history'];
} {
  const resolvedWizard = useResolvedWizard(wizard);
  const history = useStore(resolvedWizard.store, (state) => state.history);
  const methods = getBoundMethods(resolvedWizard);

  return {
    helpers: resolvedWizard.helpers,
    getStep: methods.getStep,
    getCurrentStep: methods.getCurrentStep,
    visitedSteps: history.map((entry) => entry.step),
    history,
  };
}

export function useStepError<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: WizardWithComponents<C, S, D, E>, stepName?: S): unknown;
export function useStepError<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(stepName?: S): unknown;
export function useStepError<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(
  wizardOrStepName?: WizardWithComponents<C, S, D, E> | S,
  maybeStepName?: S
): unknown {
  const hasWizardArg =
    wizardOrStepName !== undefined && typeof wizardOrStepName !== 'string';
  const resolvedWizard = useResolvedWizard(
    hasWizardArg ? (wizardOrStepName as WizardWithComponents<C, S, D, E>) : undefined
  );
  const stepName = (hasWizardArg ? maybeStepName : wizardOrStepName) as S | undefined;

  return useStore(resolvedWizard.store, (state) => {
    const target = stepName ?? state.step;
    return state.errors[target];
  });
}

export function useWizardSelector<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  Selected = unknown
>(
  wizard: WizardWithComponents<C, S, D, E>,
  selector: (state: WizardState<C, S, D>) => Selected
): Selected;
export function useWizardSelector<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  Selected = unknown
>(selector: (state: WizardState<C, S, D>) => Selected): Selected;
export function useWizardSelector<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  Selected = unknown
>(
  wizardOrSelector:
    | WizardWithComponents<C, S, D, E>
    | ((state: WizardState<C, S, D>) => Selected),
  maybeSelector?: (state: WizardState<C, S, D>) => Selected
): Selected {
  const hasWizardArg = typeof wizardOrSelector !== 'function';
  const resolvedWizard = useResolvedWizard(
    hasWizardArg ? (wizardOrSelector as WizardWithComponents<C, S, D, E>) : undefined
  );
  const selector = (hasWizardArg ? maybeSelector : wizardOrSelector) as
    | ((state: WizardState<C, S, D>) => Selected)
    | undefined;

  if (!selector) {
    throw new Error('useWizardSelector requires a selector function.');
  }

  return useStore(resolvedWizard.store, selector);
}
