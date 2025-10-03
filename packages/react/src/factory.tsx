/**
 * @wizard/react - React Wizard Factory
 * Extends core wizard factory with React component support
 */

import {
  createWizardFactory as createCoreWizardFactory,
  type EnhancedWizard,
  type EnhancedDataMapFromDefs,
  type CreateWizardOptions,
  type ValOrFn,
  type StepArgs,
  type ValidateArgs,
  type StepMetaCore,
} from '@wizard/core';
import type { StepMetaUI } from './types';
import * as React from 'react';

// Context-aware step definition with React component support
type ReactContextAwareStepArgs<C, S extends string, Data, E> = {
  step: S;
  context: Readonly<C>;
  data: Readonly<Data>;
  updateContext: (fn: (context: C) => void) => void;
  setStepData: (data: Data) => void;
  emit: (event: E) => void;
};

type ReactContextAwareStepEnterArgs<C, S extends string, Data, E> = ReactContextAwareStepArgs<C, S, Data, E> & {
  from?: S | null;
};

type ReactContextAwareStepExitArgs<C, S extends string, Data, E> = ReactContextAwareStepArgs<C, S, Data, E> & {
  to?: S | null;
};

// React-specific step definition
type ReactContextAwareStepDefinition<C, S extends string, Data, E> = {
  next: readonly S[] | ((args: ReactContextAwareStepArgs<C, S, Data, E>) => S | readonly S[]);
  data?: ValOrFn<Data, ReactContextAwareStepEnterArgs<C, S, Data, E>>;
  validate?: (args: ValidateArgs<C, Data>) => void;
  beforeExit?: (args: ReactContextAwareStepExitArgs<C, S, Data, E>) => void | Promise<void>;
  beforeEnter?: (args: ReactContextAwareStepEnterArgs<C, S, Data, E>) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
  canEnter?: ValOrFn<boolean, ReactContextAwareStepEnterArgs<C, S, Data, E>>;
  canExit?: ValOrFn<boolean, ReactContextAwareStepExitArgs<C, S, Data, E>>;
  complete?: ValOrFn<boolean, ReactContextAwareStepArgs<C, S, Data, E>>;
  weight?: ValOrFn<number, ReactContextAwareStepArgs<C, S, Data, E>>;
  required?: ValOrFn<boolean, ReactContextAwareStepArgs<C, S, Data, E>>;
  maxRetries?: ValOrFn<number, ReactContextAwareStepArgs<C, S, Data, E>>;
  retryDelay?: ValOrFn<number, ReactContextAwareStepArgs<C, S, Data, E>>;
  meta?: StepMetaCore<C, S, Data, E>;
  // React-specific fields
  component?: ValOrFn<React.ComponentType<any> | React.ReactElement, StepArgs<C, S, Data, E>>;
  uiMeta?: StepMetaUI<C, S, Data, E>;
};

/**
 * Creates a React wizard factory with context-aware step definitions and component support
 * @template C The context type (required - no default to force explicit typing)
 * @template E The event type (defaults to never)
 */
export function createReactWizardFactory<C = Record<string, never>, E = never>() {
  return {
    /**
     * Define steps with proper context typing and React component support
     * Returns the definitions as const to preserve literal types across module boundaries
     */
    defineSteps<const T extends Record<string, any>>(defs: T): T {
      return defs;
    },

    /**
     * Helper for creating a typed step with context awareness and React component
     * Explicitly captures the Data type to preserve it through module boundaries
     */
    step<Data>(
      definition: ReactContextAwareStepDefinition<C, string, Data, E>
    ): ReactContextAwareStepDefinition<C, string, Data, E> & { __data?: Data } {
      return definition as ReactContextAwareStepDefinition<C, string, Data, E> & { __data?: Data };
    },

    /**
     * Create the wizard with the defined steps
     * @param steps The wizard step definitions
     * @param options Optional configuration including context
     */
    createWizard<TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Partial<Omit<CreateWizardOptions<C, E, TDefs>, 'steps'>>
    ): EnhancedWizard<C, keyof TDefs & string, EnhancedDataMapFromDefs<TDefs>, E> & {
      // Add component getter to wizard instance
      getStepComponent: (stepName: keyof TDefs & string) => React.ComponentType<any> | React.ReactElement | null;
    } {
      const coreFactory = createCoreWizardFactory<C, E>();
      const wizard = coreFactory.createWizard(steps, options);

      // Extend wizard with component getter
      return Object.assign(wizard, {
        getStepComponent(stepName: keyof TDefs & string) {
          return steps[stepName]?.component;
        },
      });
    },
  };
}

/**
 * Convenience function for creating a React wizard with pre-bound context
 * @param context The context to bind to the wizard
 */
export function reactWizardWithContext<C, E = never>(context: C) {
  const factory = createReactWizardFactory<C, E>();

  return {
    defineSteps: factory.defineSteps,
    step: factory.step,
    createWizard: <TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Omit<CreateWizardOptions<C, E, TDefs>, 'context' | 'steps'>
    ) => factory.createWizard(steps, { context, ...options }),
  };
}
