/**
 * @wizard/react - React Wizard Factory
 * Extends core wizard factory with React component support.
 */

import * as React from 'react';
import {
  createWizardFactory as createCoreWizardFactory,
  type CreateWizardOptions,
  type DataMapFromDefs,
  type EnhancedWizard,
  type ErrorMapFromDefs,
  type StepArgs,
  type StepMetaCore,
  type ValidateArgs,
  type ValOrFn,
  type WithDataBrand,
  type WithErrorBrand,
} from '@wizard/core';
import type { StepComponent, StepComponentProps, StepMetaUI } from './types';

type FactoryStepComponent<C, S extends string, Data, E> = React.ComponentType<
  StepComponentProps<
    C,
    S,
    Record<S, Data>,
    E,
    S,
    Record<S, unknown>
  >
>;

type ReactStepDefinitionInput<C, S extends string, Data, E> = {
  next?:
    | readonly S[]
    | 'any'
    | ((args: StepArgs<C, S, Data | undefined, E>) => S | readonly S[] | 'any');
  data?: ValOrFn<Data, StepArgs<C, S, Data | undefined, E> & { from?: S | null }>;
  validate?: (args: ValidateArgs<C, Data>) => void;
  beforeExit?: (
    args: StepArgs<C, S, Data | undefined, E> & { to?: S | null }
  ) => void | Promise<void>;
  beforeEnter?: (
    args: StepArgs<C, S, Data | undefined, E> & { from?: S | null }
  ) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
  canEnter?: ValOrFn<boolean, StepArgs<C, S, Data | undefined, E> & { from?: S | null }>;
  canExit?: ValOrFn<boolean, StepArgs<C, S, Data | undefined, E> & { to?: S | null }>;
  complete?: ValOrFn<boolean, StepArgs<C, S, Data | undefined, E>>;
  weight?: ValOrFn<number, StepArgs<C, S, Data | undefined, E>>;
  required?: ValOrFn<boolean, StepArgs<C, S, Data | undefined, E>>;
  maxRetries?: ValOrFn<number, StepArgs<C, S, Data | undefined, E>>;
  retryDelay?: ValOrFn<number, StepArgs<C, S, Data | undefined, E>>;
  meta?: StepMetaCore<C, S, Data, E>;
  component?: FactoryStepComponent<C, S, Data, E>;
  uiMeta?: StepMetaUI<C, S, Data, E>;
};

type ReactWizardFactoryApi<Context, DefaultError, Event> = {
  /**
   * Freezes and returns step definitions with literal key preservation.
   */
  defineSteps<const T extends Record<string, any>>(defs: T): T;

  /**
   * Creates a typed React step definition.
   *
   * @template Data Per-step data shape.
   * @template StepError Per-step error type. Defaults to the factory-level `DefaultError`.
   */
  step<Data, StepError = DefaultError>(
    definition: ReactStepDefinitionInput<Context, string, Data, Event>
  ): ReactStepDefinitionInput<Context, string, Data, Event> &
    WithDataBrand<Data> &
    WithErrorBrand<StepError>;

  /**
   * Creates a React-aware wizard instance with `getStepComponent`.
   */
  createWizard<const TDefs extends Record<string, any>>(
    steps: TDefs,
    options?: Partial<Omit<CreateWizardOptions<Context, Event, TDefs>, 'steps'>>
  ): ReactWizardInstance<
    Context,
    keyof TDefs & string,
    DataMapFromDefs<TDefs>,
    Event,
    ErrorMapFromDefs<TDefs, DefaultError>
  >;
};

export type ReactWizardInstance<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never,
  EM extends Record<S, unknown> = Record<S, unknown>
> = EnhancedWizard<C, S, D, E, EM> & {
  getStepComponent: (stepName: S) => StepComponent<C, S, D, E, S, EM> | undefined;
};

/**
 * Creates a React-aware wizard factory.
 *
 * @template Context Shared wizard context shape.
 * @template DefaultError Default error type used by steps that do not override `StepError`.
 * @template Event Event type accepted by `emit()` in step callbacks.
 *
 * @example
 * ```ts
 * const factory = createReactWizardFactory<{ locale: 'en' | 'fr' }>();
 * ```
 *
 * @example
 * ```ts
 * const factory = createReactWizardFactory<{ locale: 'en' | 'fr' }, Error>();
 * ```
 */
export function createReactWizardFactory<
  Context = Record<string, never>,
  DefaultError = unknown,
  Event = never
>(): ReactWizardFactoryApi<Context, DefaultError, Event> {
  const coreFactory = createCoreWizardFactory<Context, DefaultError, Event>();

  return {
    defineSteps<const T extends Record<string, any>>(defs: T): T {
      return defs;
    },

    step<Data, StepError = DefaultError>(
      definition: ReactStepDefinitionInput<Context, string, Data, Event>
    ): ReactStepDefinitionInput<Context, string, Data, Event> &
      WithDataBrand<Data> &
      WithErrorBrand<StepError> {
      return definition as ReactStepDefinitionInput<Context, string, Data, Event> &
        WithDataBrand<Data> &
        WithErrorBrand<StepError>;
    },

    createWizard<const TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Partial<Omit<CreateWizardOptions<Context, Event, TDefs>, 'steps'>>
    ): ReactWizardInstance<
      Context,
      keyof TDefs & string,
      DataMapFromDefs<TDefs>,
      Event,
      ErrorMapFromDefs<TDefs, DefaultError>
    > {
      type StepName = keyof TDefs & string;
      type WizardDataMap = DataMapFromDefs<TDefs>;
      type WizardErrorMap = ErrorMapFromDefs<TDefs, DefaultError>;

      const wizard = coreFactory.createWizard(steps, options);

      return Object.assign(wizard, {
        getStepComponent(stepName: StepName) {
          const definition = steps[stepName] as { component?: unknown } | undefined;
          if (!definition) {
            return undefined;
          }

          if (typeof definition.component === 'function') {
            return definition.component as StepComponent<
              Context,
              StepName,
              WizardDataMap,
              Event,
              StepName,
              WizardErrorMap
            >;
          }

          return undefined;
        },
      });
    },
  };
}
