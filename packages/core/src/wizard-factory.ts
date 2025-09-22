/**
 * Wizard Factory with Context-Aware defineSteps
 * This provides proper context type inference in step callbacks
 */

import type {
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
  ValidateArgs,
  ValOrFn,
  Wizard,
  EnhancedWizard,
  WizardState,
  CreateWizardOptions,
  EnhancedDataMapFromDefs
} from './types';
import { createWizard as createWizardImpl } from './wizard';

// Context-aware step definition types
type ContextAwareStepArgs<C, S extends string, Data, E> = {
  step: S;
  context: Readonly<C>;
  data: Readonly<Data>;
  updateContext: (fn: (context: C) => void) => void;
  setStepData: (data: Data) => void;
  emit: (event: E) => void;
};

type ContextAwareStepEnterArgs<C, S extends string, Data, E> = ContextAwareStepArgs<C, S, Data, E> & {
  from?: S | null;
};

type ContextAwareStepExitArgs<C, S extends string, Data, E> = ContextAwareStepArgs<C, S, Data, E> & {
  to?: S | null;
};

// Context-aware step definition
type ContextAwareStepDefinition<C, S extends string, Data, E> = {
  next: readonly S[] | ((args: ContextAwareStepArgs<C, S, Data, E>) => S | readonly S[]);
  data?: ValOrFn<Data, ContextAwareStepEnterArgs<C, S, Data, E>>;
  validate?: (args: ValidateArgs<C>) => void;
  beforeExit?: (args: ContextAwareStepExitArgs<C, S, Data, E>) => void | Promise<void>;
  beforeEnter?: (args: ContextAwareStepEnterArgs<C, S, Data, E>) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
  canEnter?: ValOrFn<boolean, ContextAwareStepEnterArgs<C, S, Data, E>>;
  canExit?: ValOrFn<boolean, ContextAwareStepExitArgs<C, S, Data, E>>;
  complete?: ValOrFn<boolean, ContextAwareStepArgs<C, S, Data, E>>;
  weight?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  required?: ValOrFn<boolean, ContextAwareStepArgs<C, S, Data, E>>;
  maxRetries?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  retryDelay?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  meta?: any;
};

// Extract data type from step definition
type ExtractDataType<T> =
  T extends { validate: (args: { data: infer D }) => any }
    ? D
    : T extends { data: infer D }
      ? D
      : unknown;

/**
 * Creates a wizard factory with context-aware step definitions
 */
export function createWizardFactory<C, E = never>() {
  return {
    /**
     * Define steps with proper context typing
     * Note: Due to TypeScript limitations, you still need explicit typing in callback parameters
     */
    defineSteps<T extends Record<string, any>>(defs: T): {
      [K in keyof T]: ContextAwareStepDefinition<C, K & string, ExtractDataType<T[K]>, E>
    } {
      return defs as any;
    },

    /**
     * Helper for creating a typed step with context awareness
     */
    step<Data>(definition: {
      data?: Data;
      next: readonly string[] | ((args: ContextAwareStepArgs<C, string, Data, E>) => string | readonly string[]);
      beforeExit?: (args: ContextAwareStepExitArgs<C, string, Data, E>) => void | Promise<void>;
      beforeEnter?: (args: ContextAwareStepEnterArgs<C, string, Data, E>) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
      canEnter?: boolean | ((args: ContextAwareStepEnterArgs<C, string, Data, E>) => boolean);
      canExit?: boolean | ((args: ContextAwareStepExitArgs<C, string, Data, E>) => boolean);
      complete?: boolean | ((args: ContextAwareStepArgs<C, string, Data, E>) => boolean);
      validate?: (args: ValidateArgs<C>) => void;
      weight?: number | ((args: ContextAwareStepArgs<C, string, Data, E>) => number);
      required?: boolean | ((args: ContextAwareStepArgs<C, string, Data, E>) => boolean);
      maxRetries?: number | ((args: ContextAwareStepArgs<C, string, Data, E>) => number);
      retryDelay?: number | ((args: ContextAwareStepArgs<C, string, Data, E>) => number);
      meta?: any;
    }): ContextAwareStepDefinition<C, string, Data, E> {
      return definition as any;
    },

    /**
     * Create the wizard with the defined steps
     */
    createWizard<TDefs extends Record<string, any>>(
      context: C,
      steps: TDefs,
      options?: Omit<CreateWizardOptions<C, E, TDefs>, 'context' | 'steps'>
    ): EnhancedWizard<C, keyof TDefs & string, EnhancedDataMapFromDefs<TDefs>, E> {
      return createWizardImpl({
        context,
        steps,
        ...options
      }) as EnhancedWizard<C, keyof TDefs & string, EnhancedDataMapFromDefs<TDefs>, E>;
    }
  };
}

/**
 * Convenience function for creating a wizard with context inference
 */
export function wizardWithContext<C, E = never>(context: C) {
  const factory = createWizardFactory<C, E>();

  return {
    defineSteps: factory.defineSteps,
    step: factory.step,
    createWizard: <TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Omit<CreateWizardOptions<C, E, TDefs>, 'context' | 'steps'>
    ): EnhancedWizard<C, keyof TDefs & string, EnhancedDataMapFromDefs<TDefs>, E> =>
      factory.createWizard(context, steps, options)
  };
}