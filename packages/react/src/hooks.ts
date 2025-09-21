import { useEffect, useState, useCallback } from 'react';
import { useStore } from '@tanstack/react-store';
import { useWizardContext } from './context';
import type { Wizard, WizardState } from '@wizard/core';

/**
 * Hook to access the wizard instance
 * @returns The wizard instance from context
 */
export function useWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>(): Wizard<C, S, D, E> {
  const { wizard } = useWizardContext<C, S, D, E>();
  return wizard;
}

/**
 * Hook to subscribe to wizard state with optional selector
 * @param selector - Function to select a slice of state
 * @param equals - Optional equality function for optimization
 * @returns Selected state slice
 */
export function useWizardState<
  C,
  S extends string,
  D extends Record<S, unknown>,
  T = WizardState<C, S, D>
>(
  selector?: (state: WizardState<C, S, D>) => T,
  equals?: (a: T, b: T) => boolean
): T {
  const { wizard } = useWizardContext<C, S, D>();

  // Default selector returns entire state
  const actualSelector = selector || ((state) => state as unknown as T);

  // Use @tanstack/react-store for subscription
  const state = useStore(wizard.store, actualSelector);

  // Memoize result with custom equality if provided
  const [memoizedState, setMemoizedState] = useState(state);

  useEffect(() => {
    if (equals && !equals(memoizedState, state)) {
      setMemoizedState(state);
    } else if (!equals && !Object.is(memoizedState, state)) {
      setMemoizedState(state);
    }
  }, [state, memoizedState, equals]);

  return equals ? memoizedState : state;
}

/**
 * Hook to get the current step
 */
export function useWizardStep<
  C,
  S extends string,
  D extends Record<S, unknown>
>(): S {
  return useWizardState<C, S, D, S>((state) => state.step);
}

/**
 * Hook to get the current shared context
 */
export function useWizardSharedContext<
  C,
  S extends string,
  D extends Record<S, unknown>
>(): C {
  return useWizardState<C, S, D, C>((state) => state.context);
}

/**
 * Hook to get data for a specific step
 */
export function useStepData<
  C,
  S extends string,
  D extends Record<S, unknown>,
  K extends S
>(step: K): D[K] | undefined {
  return useWizardState<C, S, D, D[K] | undefined>(
    (state) => state.data[step] as D[K] | undefined
  );
}

/**
 * Hook to get current step data
 */
export function useCurrentStepData<
  C,
  S extends string,
  D extends Record<S, unknown>
>(): D[S] | undefined {
  return useWizardState<C, S, D, D[S] | undefined>((state) => {
    const currentStep = state.step;
    return state.data[currentStep] as D[S] | undefined;
  });
}

/**
 * Hook to get wizard loading state
 */
export function useWizardLoading<
  C,
  S extends string,
  D extends Record<S, unknown>
>(): boolean {
  return useWizardState<C, S, D, boolean>((state) => state.isLoading);
}

/**
 * Hook to get wizard transitioning state
 */
export function useWizardTransitioning<
  C,
  S extends string,
  D extends Record<S, unknown>
>(): boolean {
  return useWizardState<C, S, D, boolean>((state) => state.isTransitioning);
}

/**
 * Hook to get wizard history
 */
export function useWizardHistory<
  C,
  S extends string,
  D extends Record<S, unknown>
>(): Array<{ step: S; context: C; data: Partial<D> }> {
  return useWizardState<C, S, D, Array<{ step: S; context: C; data: Partial<D> }>>(
    (state) => state.history
  );
}

/**
 * Hook to get wizard errors
 */
export function useWizardErrors<
  C,
  S extends string,
  D extends Record<S, unknown>
>(): Partial<Record<S, unknown>> {
  return useWizardState<C, S, D, Partial<Record<S, unknown>>>(
    (state) => state.errors
  );
}

/**
 * Hook for wizard navigation actions
 */
export function useWizardActions<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
>() {
  const wizard = useWizard<C, S, D, E>();
  
  return {
    next: useCallback(
      (data?: D[S]) => wizard.next({ data }),
      [wizard]
    ),
    goTo: useCallback(
      (step: S, data?: D[S]) => wizard.goTo(step, { data }),
      [wizard]
    ),
    back: useCallback(() => wizard.back(), [wizard]),
    reset: useCallback(() => wizard.reset(), [wizard]),
    updateContext: useCallback(
      (updater: (ctx: C) => void) => wizard.updateContext(updater),
      [wizard]
    ),
    setStepData: useCallback(
      (step: S, data: D[S]) => wizard.setStepData(step, data),
      [wizard]
    ),
  };
}