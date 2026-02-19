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
  WithErrorBrand,
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
  next?:
    | readonly string[]
    | 'any'
    | ((
        args: StepArgs<Context, string, Data | undefined, never>
      ) => string | readonly string[] | 'any');
  data?: ValOrFn<Data, StepEnterArgs<Context, string, Data | undefined, never>>;
} & StepCallbacks<Data, Context>;

// ===== Public helpers =====

/**
 * Creates a branded step definition for direct `createWizard` usage.
 *
 * Generic order differs from factory `step`:
 * `step<Data, Context, StepError>(definition)`.
 *
 * @template Data Per-step data shape.
 * @template Context Context shape available in callbacks.
 * @template StepError Per-step error type brand.
 */
export function step<Data, Context = unknown, StepError = unknown>(
  definition: StepDefinitionInput<Data, Context>
): StepDefinitionInput<Data, Context> &
  WithDataBrand<Data> &
  WithErrorBrand<StepError> {
  return definition as StepDefinitionInput<Data, Context> &
    WithDataBrand<Data> &
    WithErrorBrand<StepError>;
}

/**
 * Creates a branded step definition and injects a required `validate` callback.
 *
 * Generic order matches `step`: `stepWithValidation<Data, Context, StepError>(...)`.
 *
 * @template Data Per-step data shape.
 * @template Context Context shape available in callbacks.
 * @template StepError Per-step error type brand.
 */
export function stepWithValidation<Data, Context = unknown, StepError = unknown>(
  validateFn: (args: ValidateArgs<Context, Data>) => void,
  definition: Omit<StepDefinitionInput<Data, Context>, 'validate'> & {
    validate?: (args: ValidateArgs<Context, Data>) => void;
  }
): StepDefinitionInput<Data, Context> &
  WithDataBrand<Data> &
  WithErrorBrand<StepError> & {
    validate: (args: ValidateArgs<Context, Data>) => void;
  } {
  return {
    ...definition,
    validate: validateFn,
  } as StepDefinitionInput<Data, Context> &
    WithDataBrand<Data> &
    WithErrorBrand<StepError> & {
      validate: (args: ValidateArgs<Context, Data>) => void;
    };
}
