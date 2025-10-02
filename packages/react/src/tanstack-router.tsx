/**
 * @wizard/react - TanStack Router Integration
 * Dynamic route helper for wizard integration with TanStack Router
 */

import * as React from 'react';
import { useEffect } from 'react';
import { useWizard } from './hooks';
import { resolveStepComponent } from './types';
import type { Wizard, StepArgs } from '@wizard/core';

export interface CreateWizardRouteOptions<C, S extends string, D extends Record<S, unknown>, E> {
  /**
   * Wizard instance with component support
   */
  wizard: Wizard<C, S, D, E> & {
    getStepComponent?: (stepName: S) => any;
  };

  /**
   * TanStack Router hooks (passed from user since we don't have hard dependency)
   */
  useNavigate: () => (options: { to: string; params?: Record<string, string> }) => void;
  useParams: () => Record<string, string>;

  /**
   * Base path for the wizard (e.g., '/checkout')
   */
  basePath: string;

  /**
   * Name of the param used for step (defaults to 'step')
   */
  stepParam?: string;

  /**
   * Optional fallback component when step component is not defined
   */
  fallbackComponent?: React.ComponentType<{ stepName: S }>;
}

/**
 * Creates a TanStack Router route configuration for a wizard
 * Returns a standard route config object that can be spread into createFileRoute()
 */
export function createWizardRoute<C, S extends string, D extends Record<S, unknown>, E>(
  options: CreateWizardRouteOptions<C, S, D, E>
) {
  const {
    wizard,
    useNavigate: useNavigateHook,
    useParams: useParamsHook,
    basePath,
    stepParam = 'step',
    fallbackComponent: FallbackComponent,
  } = options;

  // Main component that handles wizard rendering and sync
  function WizardRouteComponent() {
    const navigate = useNavigateHook();
    const params = useParamsHook();
    const { step: currentStep, data, context } = useWizard(wizard);

    const urlStep = params[stepParam] as S | undefined;
    const isNavigatingRef = React.useRef(false);

    // Sync: Router → Wizard (when URL changes)
    useEffect(() => {
      if (!urlStep || isNavigatingRef.current) return;

      if (urlStep !== currentStep) {
        isNavigatingRef.current = true;
        wizard.goTo(urlStep)
          .catch((err) => {
            console.error(`Failed to navigate to step: ${urlStep}`, err);
            // Navigate back to current valid step
            navigate({
              to: basePath + '/$' + stepParam,
              params: { [stepParam]: currentStep },
            });
          })
          .finally(() => {
            isNavigatingRef.current = false;
          });
      }
    }, [urlStep, currentStep, navigate]);

    // Sync: Wizard → Router (when wizard step changes programmatically)
    useEffect(() => {
      if (isNavigatingRef.current) return;

      if (urlStep !== currentStep) {
        navigate({
          to: basePath + '/$' + stepParam,
          params: { [stepParam]: currentStep },
        });
      }
    }, [currentStep, urlStep, navigate]);

    // Get and render the step component
    const stepComponent = wizard.getStepComponent?.(currentStep);

    if (!stepComponent) {
      if (FallbackComponent) {
        return <FallbackComponent stepName={currentStep} />;
      }
      return (
        <div>
          <p>No component defined for step: {currentStep}</p>
        </div>
      );
    }

    // Create step args for component resolution
    const stepData = data[currentStep];
    const stepArgs: StepArgs<C, S, typeof stepData, E> = {
      step: currentStep,
      context,
      data: stepData,
      updateContext: (fn) => {
        const newContext = { ...context };
        fn(newContext as C);
        wizard['store']?.setState((state: any) => ({
          ...state,
          context: newContext,
        }));
      },
      setStepData: (newData) => {
        wizard['store']?.setState((state: any) => ({
          ...state,
          data: { ...state.data, [currentStep]: newData },
        }));
      },
      emit: (_event: E) => {
        // Event handling can be added here
      },
    };

    // Resolve the component (handles both React components and elements)
    const resolvedComponent = resolveStepComponent(stepComponent, stepArgs);

    if (resolvedComponent) {
      return resolvedComponent;
    }

    // If component is already a React component type, render it directly
    if (typeof stepComponent === 'function') {
      const Component = stepComponent as React.ComponentType<any>;
      return <Component />;
    }

    // Fallback
    if (FallbackComponent) {
      return <FallbackComponent stepName={currentStep} />;
    }

    return (
      <div>
        <p>Unable to render component for step: {currentStep}</p>
      </div>
    );
  }

  // Return TanStack Router route configuration
  return {
    component: WizardRouteComponent,
  };
}
