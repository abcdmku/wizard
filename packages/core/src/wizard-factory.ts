/**
 * Wizard Factory with Context-Aware defineSteps
 * This provides proper context type inference in step callbacks
 */

import type {
  ValidateArgs,
  ValOrFn,
  EnhancedWizard,
  CreateWizardOptions,
  EnhancedDataMapFromDefs,
  StepMetaCore
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
  validate?: (args: ValidateArgs<C, Data>) => void;
  beforeExit?: (args: ContextAwareStepExitArgs<C, S, Data, E>) => void | Promise<void>;
  beforeEnter?: (args: ContextAwareStepEnterArgs<C, S, Data, E>) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
  canEnter?: ValOrFn<boolean, ContextAwareStepEnterArgs<C, S, Data, E>>;
  canExit?: ValOrFn<boolean, ContextAwareStepExitArgs<C, S, Data, E>>;
  complete?: ValOrFn<boolean, ContextAwareStepArgs<C, S, Data, E>>;
  weight?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  required?: ValOrFn<boolean, ContextAwareStepArgs<C, S, Data, E>>;
  maxRetries?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  retryDelay?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  meta?: StepMetaCore<C, S, Data, E>;
};


/**
 * Creates a wizard factory with context-aware step definitions
 */
export function createWizardFactory<C = any, E = never>() {
  return {
    /**
     * Define steps with proper context typing
     * Note: Due to TypeScript limitations, you still need explicit typing in callback parameters
     */
    defineSteps<T extends Record<string, any>>(defs: T): T {
      return defs;
    },

    /**
     * Helper for creating a typed step with context awareness
     */
    step<Def extends ContextAwareStepDefinition<C, string, any, E>>(
      definition: Def
    ): Def {
      return definition;
    },

    /**
     * Create the wizard with the defined steps
     * @param steps The wizard step definitions
     * @param options Optional configuration including context
     */
    createWizard<TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Partial<Omit<CreateWizardOptions<C, E, TDefs>, 'steps'>>
    ): EnhancedWizard<C, keyof TDefs & string, EnhancedDataMapFromDefs<TDefs>, E> {
      return createWizardImpl({
        context: {} as C,  // Default empty context if not provided
        ...options,
        steps
      }) as EnhancedWizard<C, keyof TDefs & string, EnhancedDataMapFromDefs<TDefs>, E>;
    }
  };
}

/**
 * Convenience function for creating a wizard with pre-bound context
 * @param context The context to bind to the wizard
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
      factory.createWizard(steps, { context, ...options })
  };
}