/**
 * Wizard factory with context-aware step authoring.
 */

import type {
  ValidateArgs,
  ValOrFn,
  EnhancedWizard,
  CreateWizardOptions,
  DataMapFromDefs,
  StepMetaCore,
  WithDataBrand,
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
  getAllStepNames: () => readonly S[];
};

type ContextAwareStepEnterArgs<C, S extends string, Data, E> =
  ContextAwareStepArgs<C, S, Data, E> & { from?: S | null };

type ContextAwareStepExitArgs<C, S extends string, Data, E> =
  ContextAwareStepArgs<C, S, Data, E> & { to?: S | null };

type ContextAwareStepDefinition<C, S extends string, Data, E> = {
  next:
    | readonly S[]
    | 'any'
    | ((args: ContextAwareStepArgs<C, S, Data, E>) => S | readonly S[] | 'any');
  data?: ValOrFn<Data, ContextAwareStepEnterArgs<C, S, Data, E>>;
  validate?: (args: ValidateArgs<C, Data>) => void;
  beforeExit?: (
    args: ContextAwareStepExitArgs<C, S, Data, E>
  ) => void | Promise<void>;
  beforeEnter?: (
    args: ContextAwareStepEnterArgs<C, S, Data, E>
  ) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
  canEnter?: ValOrFn<boolean, ContextAwareStepEnterArgs<C, S, Data, E>>;
  canExit?: ValOrFn<boolean, ContextAwareStepExitArgs<C, S, Data, E>>;
  complete?: ValOrFn<boolean, ContextAwareStepArgs<C, S, Data, E>>;
  weight?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  required?: ValOrFn<boolean, ContextAwareStepArgs<C, S, Data, E>>;
  maxRetries?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  retryDelay?: ValOrFn<number, ContextAwareStepArgs<C, S, Data, E>>;
  meta?: StepMetaCore<C, S, Data, E>;
};

export function createWizardFactory<C = Record<string, never>, E = never>() {
  return {
    defineSteps<const T extends Record<string, any>>(defs: T): T {
      return defs;
    },

    step<Data>(
      definition: ContextAwareStepDefinition<C, string, Data, E>
    ): ContextAwareStepDefinition<C, string, Data, E> & WithDataBrand<Data> {
      return definition as ContextAwareStepDefinition<C, string, Data, E> &
        WithDataBrand<Data>;
    },

    createWizard<const TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Partial<Omit<CreateWizardOptions<C, E, TDefs>, 'steps'>>
    ): EnhancedWizard<C, keyof TDefs & string, DataMapFromDefs<TDefs>, E> {
      return createWizardImpl({
        context: ({} as C),
        ...options,
        steps,
      }) as EnhancedWizard<C, keyof TDefs & string, DataMapFromDefs<TDefs>, E>;
    },
  };
}
