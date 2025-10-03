import { useStore } from '@tanstack/react-store';
import type { Wizard, WizardState } from '@wizard/core';
import type { ReactWizardStep } from './types';
import { wrapWithReactStep } from './step-wrapper';

/**
 * Kitchen sink hook that returns everything from the wizard.
 * Returns flattened state properties and all wizard methods.
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
>(wizard: Wizard<C, S, D, E> & { getStepComponent?: (stepName: S) => any }) {
  const state = useStore(wizard.store);

  // Wrap getCurrentStep with React component support
  const getComponent = (stepName: S) => wizard.getStepComponent?.(stepName);
  const currentStep = wrapWithReactStep(wizard.getCurrentStep(), getComponent);

  return {
    // Flattened state properties
    step: state.step,
    currentStep,
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
 * Returns the current active step wrapper with React component support.
 *
 * @param wizard - The wizard instance
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const step = useCurrentStep(FormWizard);
 *   return <div>Current step: {step.name}</div>;
 * }
 *
 * // Or create a typed convenience hook:
 * export const useFormWizardCurrentStep = () => useCurrentStep(FormWizard);
 * ```
 */
export function useCurrentStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: Wizard<C, S, D, E> & { getStepComponent?: (stepName: S) => any }): ReactWizardStep<S, D[S], C, S, D> {
  // Subscribe to current step changes
  useStore(wizard.store, (state) => state.step);
  const getComponent = (stepName: S) => wizard.getStepComponent?.(stepName);
  return wrapWithReactStep(wizard.getCurrentStep(), getComponent);
}

/**
 * Returns a specific step wrapper by name with React component support.
 *
 * @param wizard - The wizard instance
 * @param stepName - The name of the step to get
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const accountStep = useWizardStep(FormWizard, 'account');
 *   return <div>Status: {accountStep.status}</div>;
 * }
 *
 * // Or create a typed convenience hook:
 * export const useAccountStep = () => useWizardStep(FormWizard, 'account');
 * ```
 */
export function useWizardStep<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  K extends S = S
>(wizard: Wizard<C, S, D, E> & { getStepComponent?: (stepName: S) => any }, stepName: K): ReactWizardStep<K, D[K], C, S, D> {
  // Re-render when step data or runtime changes
  useStore(wizard.store, (state) => ({
    data: state.data[stepName],
    runtime: state.runtime?.[stepName],
  }));

  const getComponent = (stepName: S) => wizard.getStepComponent?.(stepName);
  return wrapWithReactStep(wizard.getStep(stepName), getComponent);
}

/**
 * Returns progress metrics for the wizard.
 *
 * @param wizard - The wizard instance
 *
 * @example
 * ```tsx
 * function ProgressBar() {
 *   const { percentage, currentIndex, totalSteps } = useWizardProgress(FormWizard);
 *   return <div style={{ width: `${percentage}%` }} />;
 * }
 *
 * // Or create a typed convenience hook:
 * export const useFormWizardProgress = () => useWizardProgress(FormWizard);
 * ```
 */
export function useWizardProgress<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: Wizard<C, S, D, E>) {
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
 * @param wizard - The wizard instance
 *
 * @example
 * ```tsx
 * function NavigationButtons() {
 *   const { next, back, goTo } = useWizardActions(FormWizard);
 *   return (
 *     <div>
 *       <button onClick={back}>Back</button>
 *       <button onClick={next}>Next</button>
 *     </div>
 *   );
 * }
 *
 * // Or create a typed convenience hook:
 * export const useFormWizardActions = () => useWizardActions(FormWizard);
 * ```
 */
export function useWizardActions<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: Wizard<C, S, D, E>) {
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
 * @param wizard - The wizard instance
 *
 * @example
 * ```tsx
 * function StepList() {
 *   const { helpers, visitedSteps } = useWizardHelpers(FormWizard);
 *   return (
 *     <ul>
 *       {helpers.allSteps().map(step => (
 *         <li key={step.name}>{step.name}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 *
 * // Or create a typed convenience hook:
 * export const useFormWizardHelpers = () => useWizardHelpers(FormWizard);
 * ```
 */
export function useWizardHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: Wizard<C, S, D, E>) {
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
 * @param wizard - The wizard instance
 * @param stepName - Optional step name. If not provided, returns error for current step.
 *
 * @example
 * ```tsx
 * function ErrorDisplay() {
 *   const error = useStepError(FormWizard, 'account');
 *   if (!error) return null;
 *   return <div className="error">{String(error)}</div>;
 * }
 *
 * // Or create a typed convenience hook:
 * export const useAccountStepError = () => useStepError(FormWizard, 'account');
 * ```
 */
export function useStepError<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(wizard: Wizard<C, S, D, E>, stepName?: S) {
  const error = useStore(wizard.store, (state) => {
    const name = stepName || state.step;
    return state.errors[name];
  });

  return error;
}

/**
 * Performance-optimized hook that lets you select specific data from wizard state.
 * Use this for fine-grained control over re-renders.
 *
 * @param wizard - The wizard instance
 * @param selector - Function to select data from wizard state
 *
 * @example
 * ```tsx
 * function UserEmail() {
 *   const email = useWizardSelector(FormWizard, state => state.data.account?.email);
 *   return <div>{email}</div>;
 * }
 * ```
 */
export function useWizardSelector<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  Selected = any
>(
  wizard: Wizard<C, S, D, E>,
  selector: (state: WizardState<C, S, D>) => Selected
) {
  return useStore(wizard.store, selector);
}