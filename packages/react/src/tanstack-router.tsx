/**
 * @wizard/react - TanStack Router Integration
 * Dynamic route helper for wizard integration with TanStack Router
 */

import * as React from 'react';
import { useEffect } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useWizard } from './hooks';
import { resolveStepComponent } from './types';
import type { Wizard, StepArgs } from '@wizard/core';

export interface CreateWizardRouteConfig<C, S extends string, D extends Record<S, unknown>, E> {
  /**
   * Wizard instance with component support
   */
  wizard: Wizard<C, S, D, E> & {
    getStepComponent?: (stepName: S) => any;
  };

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
 * Creates a wizard route component for TanStack Router
 */
export function createWizardRouteComponent<C, S extends string, D extends Record<S, unknown>, E>(
  config: CreateWizardRouteConfig<C, S, D, E>
) {
  const {
    wizard,
    stepParam = 'step',
    fallbackComponent: FallbackComponent,
  } = config;

  // Create a stable step renderer component to prevent hooks errors
  const StepRenderer = React.memo<{ stepName: S }>(({ stepName }) => {
    const { data, context } = useWizard(wizard);

    // Get and render the step component
    const stepComponent = wizard.getStepComponent?.(stepName);

    if (!stepComponent) {
      if (FallbackComponent) {
        return <FallbackComponent stepName={stepName} />;
      }
      return (
        <div>
          <p>No component defined for step: {stepName}</p>
        </div>
      );
    }

    // Create step args for component resolution
    const stepData = data[stepName];
    const stepArgs: StepArgs<C, S, typeof stepData, E> = {
      step: stepName,
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
          data: { ...state.data, [stepName]: newData },
        }));
      },
      emit: (_event: E) => {
        // Event handling can be added here
      },
    };

    // Resolve the component (handles both React components and elements)
    const resolvedComponent = resolveStepComponent(stepComponent, stepArgs);

    if (resolvedComponent) {
      return <>{resolvedComponent}</>;
    }

    // If component is already a React component type, render it directly
    if (typeof stepComponent === 'function') {
      const Component = stepComponent as React.ComponentType<any>;
      return <Component />;
    }

    // Fallback
    if (FallbackComponent) {
      return <FallbackComponent stepName={stepName} />;
    }

    return (
      <div>
        <p>Unable to render component for step: {stepName}</p>
      </div>
    );
  });

  // Return the component function
  return function WizardRouteComponent() {
    const navigate = useNavigate();
    const params = useParams({ strict: false });

    // Extract base path from current route (remove the param segment)
    const currentPath = window.location.pathname;
    const basePath = currentPath.substring(0, currentPath.lastIndexOf('/'));

    const urlStep = params[stepParam] as S | undefined;

    // Override wizard navigation methods to use URL navigation
    React.useEffect(() => {
      const originalNext = wizard.next.bind(wizard);
      const originalBack = wizard.back.bind(wizard);
      const originalGoTo = wizard.goTo.bind(wizard);

      // Override next to navigate via URL
      wizard.next = async function(...args: any[]) {
        const result = await originalNext(...args);
        const newStep = wizard.store?.state.step;
        if (newStep && newStep !== urlStep) {
          navigate({
            to: basePath + '/$' + stepParam,
            params: { [stepParam]: newStep },
          });
        }
        return result;
      } as any;

      // Override back to use browser history
      wizard.back = async function() {
        window.history.back();
        return null as any;
      } as any;

      // Override goTo to navigate via URL
      wizard.goTo = async function(step: S, ...args: any[]) {
        // For browser history navigation, use original goTo with skipGuards
        if (args[0]?.skipGuards) {
          return originalGoTo(step, ...args);
        }

        // For programmatic navigation, validate first then navigate
        const result = await originalGoTo(step, ...args);
        if (step !== urlStep) {
          navigate({
            to: basePath + '/$' + stepParam,
            params: { [stepParam]: step },
          });
        }
        return result;
      } as any;

      return () => {
        wizard.next = originalNext;
        wizard.back = originalBack;
        wizard.goTo = originalGoTo;
      };
    }, [navigate, basePath, urlStep]);

    // Sync URL to wizard state (only for initial load and browser navigation)
    useEffect(() => {
      if (!urlStep) return;

      const currentStep = wizard.store?.state.step;
      if (urlStep !== currentStep) {
        wizard.goTo(urlStep, { skipGuards: true } as any).catch((err) => {
          console.error(`Failed to navigate to step: ${urlStep}`, err);
        });
      }
    }, [urlStep]);

    // Render current URL step
    return <StepRenderer key={urlStep} stepName={urlStep!} />;
  };
}
