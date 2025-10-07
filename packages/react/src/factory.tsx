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
  getAllStepNames: () => readonly S[];
};

type ReactContextAwareStepEnterArgs<C, S extends string, Data, E> = ReactContextAwareStepArgs<C, S, Data, E> & {
  from?: S | null;
};

type ReactContextAwareStepExitArgs<C, S extends string, Data, E> = ReactContextAwareStepArgs<C, S, Data, E> & {
  to?: S | null;
};

// React-specific step definition
type ReactContextAwareStepDefinition<C, S extends string, Data, E> = {
  next: readonly S[] | "any" | ((args: ReactContextAwareStepArgs<C, S, Data, E>) => S | readonly S[] | "any");
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
  component?: ValOrFn<React.ReactNode, StepArgs<C, S, Data, E>>;
  uiMeta?: StepMetaUI<C, S, Data, E>;
};

// Type-safe step builder that knows about all step names
type TypedStepBuilder<C, E, StepNames extends string> = <Data>(
  definition: ReactContextAwareStepDefinition<C, StepNames, Data, E>
) => ReactContextAwareStepDefinition<C, StepNames, Data, E> & { __data?: Data };

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
     *
     * @template Data The data type for this step
     */
    step<Data>(
      definition: ReactContextAwareStepDefinition<C, string, Data, E>
    ): ReactContextAwareStepDefinition<C, string, Data, E> & { __data?: Data } {
      return definition as any;
    },

    /**
     * Creates a type-safe step builder that validates step names
     * @template StepNames Union of valid step names
     */
    createStepBuilder<StepNames extends string>(): TypedStepBuilder<C, E, StepNames> {
      return function<Data>(definition: ReactContextAwareStepDefinition<C, StepNames, Data, E>) {
        return definition as any;
      };
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
      getStepComponent: (stepName: keyof TDefs & string) => React.ReactNode;
    } {
      const coreFactory = createCoreWizardFactory<C, E>();
      const wizard = coreFactory.createWizard(steps, options);

      // Extend wizard with component getter
      return Object.assign(wizard, {
        getStepComponent(stepName: keyof TDefs & string) {
          const comp = steps[stepName]?.component;
          if (!comp) return null;

          // If it's a React component function, return it as a JSX element
          if (typeof comp === 'function') {
            return React.createElement(comp as React.ComponentType);
          }

          return comp;
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
    /**
     * Creates a wizard builder with type-safe step definitions
     * This is the recommended approach for full type safety
     */
    builder<StepNames extends string>() {
      type StepBuilder = <Data>(
        definition: ReactContextAwareStepDefinition<C, StepNames, Data, E>
      ) => ReactContextAwareStepDefinition<C, StepNames, Data, E> & { __data?: Data };

      const step: StepBuilder = (definition) => definition as any;

      return {
        step,
        build<const T extends Record<StepNames, any>>(steps: T): T {
          return steps;
        },
      };
    },

    /**
     * Define wizard steps - returns builder to provide typed step() helper
     *
     * @example
     * const { step, registerSteps } = defineSteps();
     * const steps = registerSteps({
     *   start: step({ data: {}, next: ['end'] }),
     *   end: step({ data: {}, next: [] })
     * });
     */
    defineSteps<StepNames extends string = string>() {
      type StepFn = <Data>(
        def: ReactContextAwareStepDefinition<C, StepNames, Data, E>
      ) => ReactContextAwareStepDefinition<C, StepNames, Data, E> & { __data?: Data };

      const step: StepFn = function<Data>(def: ReactContextAwareStepDefinition<C, StepNames, Data, E>) {
        return def as any;
      };

      return {
        step,
        registerSteps<const T extends Partial<Record<StepNames, any>>>(defs: T): T {
          return defs;
        }
      };
    },

    step: factory.step,
    createStepBuilder: factory.createStepBuilder,
    createWizard: <TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Omit<CreateWizardOptions<C, E, TDefs>, 'context' | 'steps'>
    ) => factory.createWizard(steps, { context, ...options }),
  };
}
