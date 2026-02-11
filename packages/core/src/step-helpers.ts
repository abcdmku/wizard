/**
 * @wizard/core - Step helper functions
 * Provides ergonomic step authoring with stable data inference.
 */

import type {
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
  ValidateArgs,
  ValOrFn,
  WithDataBrand,
} from './types';

// ===== Helper Types =====

type StepCallbacks<Data, Context = unknown> = {
  beforeExit?: (
    args: StepExitArgs<Context, string, Data | undefined, never>
  ) => void | Promise<void>;
  beforeEnter?: (
    args: StepEnterArgs<Context, string, Data | undefined, never>
  ) =>
    | void
    | Partial<Data>
    | Data
    | Promise<void | Partial<Data> | Data>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<Context, string, Data | undefined, never>>;
  canExit?: ValOrFn<boolean, StepExitArgs<Context, string, Data | undefined, never>>;
  complete?: ValOrFn<boolean, StepArgs<Context, string, Data | undefined, never>>;
  weight?: ValOrFn<number, StepArgs<Context, string, Data | undefined, never>>;
  required?: ValOrFn<boolean, StepArgs<Context, string, Data | undefined, never>>;
  maxRetries?: ValOrFn<number, StepArgs<Context, string, Data | undefined, never>>;
  retryDelay?: ValOrFn<number, StepArgs<Context, string, Data | undefined, never>>;
};

type StepDefinitionInput<Data, Context = unknown> = {
  next:
    | readonly string[]
    | 'any'
    | ((
        args: StepArgs<Context, string, Data | undefined, never>
      ) => string | readonly string[] | 'any');
  data?: ValOrFn<Data, StepEnterArgs<Context, string, Data | undefined, never>>;
} & StepCallbacks<Data, Context>;

// ===== Public helpers =====

export function step<Data, Context = unknown>(
  definition: StepDefinitionInput<Data, Context>
): StepDefinitionInput<Data, Context> & WithDataBrand<Data> {
  return definition as StepDefinitionInput<Data, Context> & WithDataBrand<Data>;
}

export function stepWithValidation<Data, Context = unknown>(
  validateFn: (args: ValidateArgs<Context, Data>) => void,
  definition: Omit<StepDefinitionInput<Data, Context>, 'validate'> & {
    validate?: (args: ValidateArgs<Context, Data>) => void;
  }
): StepDefinitionInput<Data, Context> &
  WithDataBrand<Data> & {
    validate: (args: ValidateArgs<Context, Data>) => void;
  } {
  return {
    ...definition,
    validate: validateFn,
  } as StepDefinitionInput<Data, Context> &
    WithDataBrand<Data> & {
      validate: (args: ValidateArgs<Context, Data>) => void;
    };
}
