/**
 * @wizard/core - Step Helper Functions
 * Provides proper type inference for callback arguments in step definitions
 */

import type { StepArgs, StepEnterArgs, StepExitArgs, ValidateArgs, ValOrFn } from './types';

// ===== Helper Types =====

type StepCallbacks<Data> = {
  beforeExit?: (args: StepExitArgs<unknown, string, Data | undefined, never>) => void | Promise<void>;
  beforeEnter?: (args: StepEnterArgs<unknown, string, Data | undefined, never>) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<unknown, string, Data | undefined, never>>;
  canExit?: ValOrFn<boolean, StepExitArgs<unknown, string, Data | undefined, never>>;
  complete?: ValOrFn<boolean, StepArgs<unknown, string, Data | undefined, never>>;
  weight?: ValOrFn<number, StepArgs<unknown, string, Data | undefined, never>>;
  required?: ValOrFn<boolean, StepArgs<unknown, string, Data | undefined, never>>;
  maxRetries?: ValOrFn<number, StepArgs<unknown, string, Data | undefined, never>>;
  retryDelay?: ValOrFn<number, StepArgs<unknown, string, Data | undefined, never>>;
};

type StepDefinitionInput<Data> = {
  next: readonly string[] | ((args: StepArgs<unknown, string, Data | undefined, never>) => string | readonly string[]);
  data?: ValOrFn<Data, StepEnterArgs<unknown, string, Data | undefined, never>>;
} & StepCallbacks<Data>;

// ===== Core Helper Functions =====

/**
 * Helper function for creating properly typed step definitions.
 * Infers the data type from the `data` property and types all callbacks accordingly.
 *
 * @example
 * ```typescript
 * const myStep = step({
 *   data: { name: 'John', age: 30 },
 *   beforeExit: ({ data }) => {
 *     // data is properly typed as { name: string; age: number }
 *     console.log(data.name, data.age);
 *   },
 *   next: ['nextStep']
 * });
 * ```
 */
export function step<Data>(definition: StepDefinitionInput<Data>): StepDefinitionInput<Data> {
  return definition;
}

/**
 * Helper function for creating step definitions with validation-based typing.
 * The data type is inferred from the validation function's parameter type.
 *
 * @param validateFn - Validation function that defines the expected data type
 * @param definition - Step definition with callbacks typed according to validation
 *
 * @example
 * ```typescript
 * const validateUser = ({ data }: { data: { email: string; password: string } }) => {
 *   if (!data.email.includes('@')) throw new Error('Invalid email');
 * };
 *
 * const userStep = stepWithValidation(validateUser, {
 *   data: { email: '', password: '' },
 *   beforeExit: ({ data }) => {
 *     // data is properly typed as { email: string; password: string }
 *     console.log(data.email);
 *   },
 *   next: ['nextStep']
 * });
 * ```
 */
export function stepWithValidation<Data>(
  validateFn: (args: { data: Data }) => void,
  definition: Omit<StepDefinitionInput<Data>, 'validate'> & {
    validate?: (args: ValidateArgs<unknown>) => void;
  }
): StepDefinitionInput<Data> & { validate: (args: ValidateArgs<unknown>) => void } {
  return {
    ...definition,
    validate: validateFn as (args: ValidateArgs<unknown>) => void,
  };
}

// ===== Advanced Helpers =====

/**
 * Helper for steps that only need data initialization (no callbacks)
 */
export function dataStep<Data>(data: Data, next: readonly string[]): StepDefinitionInput<Data> {
  return { data, next };
}

/**
 * Helper for steps that are just transitions (no data, minimal logic)
 */
export function transitionStep(next: readonly string[]): StepDefinitionInput<unknown> {
  return { next };
}

/**
 * Helper for conditional steps with dynamic next logic
 */
export function conditionalStep<Data>(
  definition: StepDefinitionInput<Data> & {
    next: (args: StepArgs<unknown, string, Data, never>) => string | readonly string[];
  }
): StepDefinitionInput<Data> {
  return definition;
}