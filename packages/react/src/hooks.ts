import { useStore } from '@tanstack/react-store';
import { useWizardContext } from './context';
import type { Wizard, WizardState } from '@wizard/core';

/**
 * Kitchen sink hook that returns everything from the wizard.
 * Returns flattened state properties and all wizard methods.
 *
 * This is the only hook that takes the wizard as a value parameter,
 * making it easy to create typed convenience hooks.
 *
 * @param wizard - The wizard instance
 * @returns Complete wizard API with flattened state and methods
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { step, data, next, back } = useWizard(FormWizard);
 * }
 *
 * // Or create a typed convenience hook:
 * export const useFormWizard = () => useWizard(FormWizard);
 * ```
 */
export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: Wizard<C, S, D, E>) {
  const state = useStore(wizard.store);

  return {
    // Flattened state properties
    step: state.step,
    data: state.data,
    context: state.context,
    meta: state.meta,
    history: state.history,
    visitedSteps: state.history.map(h => h.step),
    runtime: state.runtime,
    errors: state.errors,
    isLoading: state.isLoading,
    isTransitioning: state.isTransitioning,

    // Navigation methods
    next: wizard.next.bind(wizard),
    back: wizard.back.bind(wizard),
    goTo: wizard.goTo.bind(wizard),
    reset: wizard.reset.bind(wizard),

    // Data methods
    updateStepData: wizard.updateStepData.bind(wizard),
    setStepData: wizard.setStepData.bind(wizard),
    getStepData: wizard.getStepData.bind(wizard),
    updateContext: wizard.updateContext.bind(wizard),
    getContext: wizard.getContext.bind(wizard),

    // Meta methods
    setStepMeta: wizard.setStepMeta.bind(wizard),
    updateStepMeta: wizard.updateStepMeta.bind(wizard),
    getStepMeta: wizard.getStepMeta.bind(wizard),

    // Error methods
    getStepError: wizard.getStepError.bind(wizard),
    getAllErrors: wizard.getAllErrors.bind(wizard),
    clearStepError: wizard.clearStepError.bind(wizard),
    clearAllErrors: wizard.clearAllErrors.bind(wizard),

    // Step accessors
    getStep: wizard.getStep.bind(wizard),
    getCurrentStep: wizard.getCurrentStep.bind(wizard),
    getCurrent: wizard.getCurrent.bind(wizard),

    // Status methods
    markError: wizard.markError.bind(wizard),
    markTerminated: wizard.markTerminated.bind(wizard),
    markLoading: wizard.markLoading.bind(wizard),
    markIdle: wizard.markIdle.bind(wizard),
    markSkipped: wizard.markSkipped.bind(wizard),

    // Helpers
    helpers: wizard.helpers,

    // Store reference for advanced usage
    store: wizard.store,
  };
}

/**
 * Returns the current active step wrapper.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const step = useCurrentStep<typeof FormWizard>();
 *   return <div>Current step: {step.name}</div>;
 * }
 * ```
 */
export function useCurrentStep<
  W extends Wizard<any, any, any, any>
>() {
  type C = W extends Wizard<infer Ctx, any, any, any> ? Ctx : never;
  type S = W extends Wizard<any, infer Steps, any, any> ? Steps : never;
  type D = W extends Wizard<any, any, infer Data, any> ? Data : never;
  type E = W extends Wizard<any, any, any, infer Events> ? Events : never;

  const wizard = useWizardContext<C, S, D, E>();
  // Subscribe to current step changes
  useStore(wizard.store, (state) => state.step);
  return wizard.getCurrentStep();
}

/**
 * Returns a specific step wrapper by name.
 *
 * @param stepName - The name of the step to get
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const accountStep = useWizardStep<typeof FormWizard>('account');
 *   return <div>Status: {accountStep.status}</div>;
 * }
 * ```
 */
export function useWizardStep<
  W extends Wizard<any, any, any, any>
>(stepName: W extends Wizard<any, infer S, any, any> ? S : string) {
  type C = W extends Wizard<infer Ctx, any, any, any> ? Ctx : never;
  type S = W extends Wizard<any, infer Steps, any, any> ? Steps : never;
  type D = W extends Wizard<any, any, infer Data, any> ? Data : never;
  type E = W extends Wizard<any, any, any, infer Events> ? Events : never;

  const wizard = useWizardContext<C, S, D, E>();

  // Re-render when step data or runtime changes
  useStore(wizard.store, (state) => ({
    data: state.data[stepName as S],
    runtime: state.runtime?.[stepName as S],
  }));

  return wizard.getStep(stepName as S);
}

/**
 * Returns progress metrics for the wizard.
 *
 * @example
 * ```tsx
 * function ProgressBar() {
 *   const { percentage, currentIndex, totalSteps } = useWizardProgress<typeof FormWizard>();
 *   return <div style={{ width: `${percentage}%` }} />;
 * }
 * ```
 */
export function useWizardProgress<
  W extends Wizard<any, any, any, any>
>() {
  type C = W extends Wizard<infer Ctx, any, any, any> ? Ctx : never;
  type S = W extends Wizard<any, infer Steps, any, any> ? Steps : never;
  type D = W extends Wizard<any, any, infer Data, any> ? Data : never;
  type E = W extends Wizard<any, any, any, infer Events> ? Events : never;

  const wizard = useWizardContext<C, S, D, E>();

  const progress = useStore(wizard.store, (state) => {
    const allSteps = wizard.helpers.orderedStepNames();
    const visibleSteps = allSteps.filter(
      (name) => state.runtime?.[name]?.status !== 'terminated' &&
                state.meta[name]?.hidden !== true
    );
    const currentIndex = visibleSteps.indexOf(state.step);
    const totalSteps = visibleSteps.length;
    const percentage = totalSteps > 0 ? ((currentIndex + 1) / totalSteps) * 100 : 0;

    return {
      currentIndex,
      totalSteps,
      percentage,
      visitedSteps: state.history.map(h => h.step),
      isFirstStep: currentIndex === 0,
      isLastStep: currentIndex === totalSteps - 1,
    };
  });

  return progress;
}

/**
 * Returns only the navigation actions.
 * This hook never re-renders since it only returns functions.
 *
 * @example
 * ```tsx
 * function NavigationButtons() {
 *   const { next, back, goTo } = useWizardActions<typeof FormWizard>();
 *   return (
 *     <div>
 *       <button onClick={back}>Back</button>
 *       <button onClick={next}>Next</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useWizardActions<
  W extends Wizard<any, any, any, any>
>() {
  type C = W extends Wizard<infer Ctx, any, any, any> ? Ctx : never;
  type S = W extends Wizard<any, infer Steps, any, any> ? Steps : never;
  type D = W extends Wizard<any, any, infer Data, any> ? Data : never;
  type E = W extends Wizard<any, any, any, infer Events> ? Events : never;

  const wizard = useWizardContext<C, S, D, E>();

  return {
    next: wizard.next.bind(wizard),
    back: wizard.back.bind(wizard),
    goTo: wizard.goTo.bind(wizard),
    reset: wizard.reset.bind(wizard),
    updateStepData: wizard.updateStepData.bind(wizard),
    setStepData: wizard.setStepData.bind(wizard),
    updateContext: wizard.updateContext.bind(wizard),
  };
}

/**
 * Returns helper utilities.
 *
 * @example
 * ```tsx
 * function StepList() {
 *   const { helpers, visitedSteps } = useWizardHelpers<typeof FormWizard>();
 *   return (
 *     <ul>
 *       {helpers.allSteps().map(step => (
 *         <li key={step.name}>{step.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useWizardHelpers<
  W extends Wizard<any, any, any, any>
>() {
  type C = W extends Wizard<infer Ctx, any, any, any> ? Ctx : never;
  type S = W extends Wizard<any, infer Steps, any, any> ? Steps : never;
  type D = W extends Wizard<any, any, infer Data, any> ? Data : never;
  type E = W extends Wizard<any, any, any, infer Events> ? Events : never;

  const wizard = useWizardContext<C, S, D, E>();

  // Subscribe to history for visitedSteps
  const history = useStore(wizard.store, (state) => state.history);

  return {
    helpers: wizard.helpers,
    getStep: wizard.getStep.bind(wizard),
    getCurrentStep: wizard.getCurrentStep.bind(wizard),
    visitedSteps: history.map(h => h.step),
    history,
  };
}

/**
 * Returns error for a specific step (or current step if not specified).
 *
 * @param stepName - Optional step name. If not provided, returns error for current step.
 *
 * @example
 * ```tsx
 * function ErrorDisplay() {
 *   const error = useStepError<typeof FormWizard>('account');
 *   if (!error) return null;
 *   return <div className="error">{String(error)}</div>;
 * }
 * ```
 */
export function useStepError<
  W extends Wizard<any, any, any, any>
>(stepName?: W extends Wizard<any, infer S, any, any> ? S : string) {
  type C = W extends Wizard<infer Ctx, any, any, any> ? Ctx : never;
  type S = W extends Wizard<any, infer Steps, any, any> ? Steps : never;
  type D = W extends Wizard<any, any, infer Data, any> ? Data : never;
  type E = W extends Wizard<any, any, any, infer Events> ? Events : never;

  const wizard = useWizardContext<C, S, D, E>();

  const error = useStore(wizard.store, (state) => {
    const name = stepName || state.step;
    return state.errors[name as S];
  });

  return error;
}

/**
 * Performance-optimized hook that lets you select specific data from wizard state.
 * Use this for fine-grained control over re-renders.
 *
 * @param selector - Function to select data from wizard state
 *
 * @example
 * ```tsx
 * function UserEmail() {
 *   const email = useWizardSelector<typeof FormWizard>(
 *     state => state.data.account?.email
 *   );
 *   return <div>{email}</div>;
 * }
 * ```
 */
export function useWizardSelector<
  W extends Wizard<any, any, any, any>,
  Selected
>(
  selector: (state: W extends Wizard<infer C, infer S, infer D, any> ? WizardState<C, S, D> : never) => Selected
) {
  type C = W extends Wizard<infer Ctx, any, any, any> ? Ctx : never;
  type S = W extends Wizard<any, infer Steps, any, any> ? Steps : never;
  type D = W extends Wizard<any, any, infer Data, any> ? Data : never;
  type E = W extends Wizard<any, any, any, infer Events> ? Events : never;

  const wizard = useWizardContext<C, S, D, E>();
  return useStore(wizard.store, selector as any);
}