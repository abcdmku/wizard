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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
> = Wizard<C, S, D, E, EM> & {
  getStepComponent?: (stepName: S) => StepComponent<C, S, D, E, S, EM> | undefined;
};

type BoundMethods<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  EM extends Record<S, unknown>
> = {
  next: Wizard<C, S, D, E, EM>['next'];
  back: Wizard<C, S, D, E, EM>['back'];
  goTo: Wizard<C, S, D, E, EM>['goTo'];
  reset: Wizard<C, S, D, E, EM>['reset'];
  updateStepData: Wizard<C, S, D, E, EM>['updateStepData'];
  setStepData: Wizard<C, S, D, E, EM>['setStepData'];
  getStepData: Wizard<C, S, D, E, EM>['getStepData'];
  updateContext: Wizard<C, S, D, E, EM>['updateContext'];
  getContext: Wizard<C, S, D, E, EM>['getContext'];
  setStepMeta: Wizard<C, S, D, E, EM>['setStepMeta'];
  updateStepMeta: Wizard<C, S, D, E, EM>['updateStepMeta'];
  getStepMeta: Wizard<C, S, D, E, EM>['getStepMeta'];
  getStepError: Wizard<C, S, D, E, EM>['getStepError'];
  getAllErrors: Wizard<C, S, D, E, EM>['getAllErrors'];
  clearStepError: Wizard<C, S, D, E, EM>['clearStepError'];
  clearAllErrors: Wizard<C, S, D, E, EM>['clearAllErrors'];
  getStep: Wizard<C, S, D, E, EM>['getStep'];
  getCurrentStep: Wizard<C, S, D, E, EM>['getCurrentStep'];
  getCurrent: Wizard<C, S, D, E, EM>['getCurrent'];
  markError: Wizard<C, S, D, E, EM>['markError'];
  markTerminated: Wizard<C, S, D, E, EM>['markTerminated'];
  markLoading: Wizard<C, S, D, E, EM>['markLoading'];
  markIdle: Wizard<C, S, D, E, EM>['markIdle'];
  markSkipped: Wizard<C, S, D, E, EM>['markSkipped'];
};

const boundMethodCache = new WeakMap<
  Wizard<any, any, any, any, any>,
  BoundMethods<any, any, any, any, any>
>();

function getBoundMethods<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  EM extends Record<S, unknown>
>(wizard: Wizard<C, S, D, E, EM>): BoundMethods<C, S, D, E, EM> {
  const cached = boundMethodCache.get(wizard);
  if (cached) {
    return cached as BoundMethods<C, S, D, E, EM>;
  }

  const methods: BoundMethods<C, S, D, E, EM> = {
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

function useResolvedWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  EM extends Record<S, unknown>
>(wizard?: WizardWithComponents<C, S, D, E, EM>): WizardWithComponents<C, S, D, E, EM> {
  const wizardFromContext = useContext(WizardContext) as
    | WizardWithComponents<C, S, D, E, EM>
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

function getStepComponentGetter<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  EM extends Record<S, unknown>
>(
  wizard: WizardWithComponents<C, S, D, E, EM>
) {
  return (stepName: S) => wizard.getStepComponent?.(stepName);
}

type UseWizardReturn<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  EM extends Record<S, unknown>
> = {
  step: S;
  currentStep: ReactWizardStep<S, D[S], C, S, D, EM>;
  data: Partial<D>;
  context: C;
  meta: WizardState<C, S, D, EM>['meta'];
  history: WizardState<C, S, D, EM>['history'];
  visitedSteps: S[];
  runtime: WizardState<C, S, D, EM>['runtime'];
  errors: WizardState<C, S, D, EM>['errors'];
  isLoading: boolean;
  isTransitioning: boolean;
  helpers: Wizard<C, S, D, E, EM>['helpers'];
  store: Wizard<C, S, D, E, EM>['store'];
} & BoundMethods<C, S, D, E, EM>;

export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard: WizardWithComponents<C, S, D, E, EM>
): UseWizardReturn<C, S, D, E, EM>;
export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(): UseWizardReturn<C, S, D, E, EM>;
export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard?: WizardWithComponents<C, S, D, E, EM>
): UseWizardReturn<C, S, D, E, EM> {
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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard: WizardWithComponents<C, S, D, E, EM>
): ReactWizardStep<S, D[S], C, S, D, EM>;
export function useCurrentStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(): ReactWizardStep<S, D[S], C, S, D, EM>;
export function useCurrentStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard?: WizardWithComponents<C, S, D, E, EM>
): ReactWizardStep<S, D[S], C, S, D, EM> {
  const resolvedWizard = useResolvedWizard(wizard);
  useStore(resolvedWizard.store, (state) => state.step);
  useStore(resolvedWizard.store, (state) => state.data);
  useStore(resolvedWizard.store, (state) => state.context);
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
  EM extends Record<S, unknown> = Record<S, unknown>,
  K extends S = S
>(
  wizard: WizardWithComponents<C, S, D, E, EM>,
  stepName: K
): ReactWizardStep<K, D[K], C, S, D, EM>;
export function useWizardStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>,
  K extends S = S
>(stepName: K): ReactWizardStep<K, D[K], C, S, D, EM>;
export function useWizardStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>,
  K extends S = S
>(
  wizardOrStepName: WizardWithComponents<C, S, D, E, EM> | K,
  maybeStepName?: K
): ReactWizardStep<K, D[K], C, S, D, EM> {
  const hasWizardArg = typeof wizardOrStepName !== 'string';
  const resolvedWizard = useResolvedWizard(
    hasWizardArg
      ? (wizardOrStepName as WizardWithComponents<C, S, D, E, EM>)
      : undefined
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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard: WizardWithComponents<C, S, D, E, EM>
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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard?: WizardWithComponents<C, S, D, E, EM>
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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(wizard: WizardWithComponents<C, S, D, E, EM>): Pick<
  BoundMethods<C, S, D, E, EM>,
  'next' | 'back' | 'goTo' | 'reset' | 'updateStepData' | 'setStepData' | 'updateContext'
>;
export function useWizardActions<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(): Pick<
  BoundMethods<C, S, D, E, EM>,
  'next' | 'back' | 'goTo' | 'reset' | 'updateStepData' | 'setStepData' | 'updateContext'
>;
export function useWizardActions<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard?: WizardWithComponents<C, S, D, E, EM>
): Pick<
  BoundMethods<C, S, D, E, EM>,
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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(wizard: WizardWithComponents<C, S, D, E, EM>): {
  helpers: Wizard<C, S, D, E, EM>['helpers'];
  getStep: BoundMethods<C, S, D, E, EM>['getStep'];
  getCurrentStep: BoundMethods<C, S, D, E, EM>['getCurrentStep'];
  visitedSteps: S[];
  history: WizardState<C, S, D, EM>['history'];
};
export function useWizardHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(): {
  helpers: Wizard<C, S, D, E, EM>['helpers'];
  getStep: BoundMethods<C, S, D, E, EM>['getStep'];
  getCurrentStep: BoundMethods<C, S, D, E, EM>['getCurrentStep'];
  visitedSteps: S[];
  history: WizardState<C, S, D, EM>['history'];
};
export function useWizardHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizard?: WizardWithComponents<C, S, D, E, EM>
): {
  helpers: Wizard<C, S, D, E, EM>['helpers'];
  getStep: BoundMethods<C, S, D, E, EM>['getStep'];
  getCurrentStep: BoundMethods<C, S, D, E, EM>['getCurrentStep'];
  visitedSteps: S[];
  history: WizardState<C, S, D, EM>['history'];
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
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>,
  K extends S = S
>(wizard: WizardWithComponents<C, S, D, E, EM>, stepName: K): EM[K] | undefined;
export function useStepError<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>,
  K extends S = S
>(stepName: K): EM[K] | undefined;
export function useStepError<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(wizard?: WizardWithComponents<C, S, D, E, EM>): EM[S] | undefined;
export function useStepError<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
>(
  wizardOrStepName?: WizardWithComponents<C, S, D, E, EM> | S,
  maybeStepName?: S
): EM[S] | undefined {
  const hasWizardArg =
    wizardOrStepName !== undefined && typeof wizardOrStepName !== 'string';
  const resolvedWizard = useResolvedWizard(
    hasWizardArg
      ? (wizardOrStepName as WizardWithComponents<C, S, D, E, EM>)
      : undefined
  );
  const stepName = (hasWizardArg ? maybeStepName : wizardOrStepName) as S | undefined;

  return useStore(resolvedWizard.store, (state) => {
    const target = stepName ?? state.step;
    return state.errors[target];
  }) as EM[S] | undefined;
}

export function useWizardSelector<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>,
  Selected = unknown
>(
  wizard: WizardWithComponents<C, S, D, E, EM>,
  selector: (state: WizardState<C, S, D, EM>) => Selected
): Selected;
export function useWizardSelector<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>,
  Selected = unknown
>(selector: (state: WizardState<C, S, D, EM>) => Selected): Selected;
export function useWizardSelector<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>,
  Selected = unknown
>(
  wizardOrSelector:
    | WizardWithComponents<C, S, D, E, EM>
    | ((state: WizardState<C, S, D, EM>) => Selected),
  maybeSelector?: (state: WizardState<C, S, D, EM>) => Selected
): Selected {
  const hasWizardArg = typeof wizardOrSelector !== 'function';
  const resolvedWizard = useResolvedWizard(
    hasWizardArg
      ? (wizardOrSelector as WizardWithComponents<C, S, D, E, EM>)
      : undefined
  );
  const selector = (hasWizardArg ? maybeSelector : wizardOrSelector) as
    | ((state: WizardState<C, S, D, EM>) => Selected)
    | undefined;

  if (!selector) {
    throw new Error('useWizardSelector requires a selector function.');
  }

  return useStore(resolvedWizard.store, selector);
}
