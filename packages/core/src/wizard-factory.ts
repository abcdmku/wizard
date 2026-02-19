/**
 * Wizard factory with context-aware step authoring.
 */

import type {
  ValidateArgs,
  ValOrFn,
  EnhancedWizard,
  CreateWizardOptions,
  DataMapFromDefs,
  ErrorMapFromDefs,
  StepMetaCore,
  WithDataBrand,
  WithErrorBrand,
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
  next?:
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

type WizardFactoryApi<Context, DefaultError, Event> = {
  /**
   * Freezes and returns step definitions with literal key preservation.
   */
  defineSteps<const T extends Record<string, any>>(defs: T): T;

  /**
   * Creates a typed step definition.
   *
   * @template Data Per-step data shape.
   * @template StepError Per-step error type. Defaults to the factory-level `DefaultError`.
   */
  step<Data, StepError = DefaultError>(
    definition: ContextAwareStepDefinition<Context, string, Data, Event>
  ): ContextAwareStepDefinition<Context, string, Data, Event> &
    WithDataBrand<Data> &
    WithErrorBrand<StepError>;

  /**
   * Creates a wizard instance from previously defined steps.
   */
  createWizard<const TDefs extends Record<string, any>>(
    steps: TDefs,
    options?: Partial<Omit<CreateWizardOptions<Context, Event, TDefs>, 'steps'>>
  ): EnhancedWizard<
    Context,
    keyof TDefs & string,
    DataMapFromDefs<TDefs>,
    Event,
    ErrorMapFromDefs<TDefs, DefaultError>
  >;
};

/**
 * Creates a strongly typed factory for wizard authoring.
 *
 * @template Context Shared wizard context shape.
 * @template DefaultError Default error type used by steps that do not override `StepError`.
 * @template Event Event type accepted by `emit()` in step callbacks.
 *
 * @example
 * ```ts
 * const factory = createWizardFactory<{ locale: 'en' | 'fr' }>();
 * ```
 *
 * @example
 * ```ts
 * const factory = createWizardFactory<{ locale: 'en' | 'fr' }, Error>();
 * ```
 *
 * @example
 * ```ts
 * type WizardEvent = { type: 'analytics'; step: string };
 * const factory = createWizardFactory<{ locale: 'en' | 'fr' }, Error, WizardEvent>();
 * ```
 */
export function createWizardFactory<
  Context = Record<string, never>,
  DefaultError = unknown,
  Event = never
>(): WizardFactoryApi<Context, DefaultError, Event> {
  return {
    defineSteps<const T extends Record<string, any>>(defs: T): T {
      return defs;
    },

    step<Data, StepError = DefaultError>(
      definition: ContextAwareStepDefinition<Context, string, Data, Event>
    ): ContextAwareStepDefinition<Context, string, Data, Event> &
      WithDataBrand<Data> &
      WithErrorBrand<StepError> {
      return definition as ContextAwareStepDefinition<Context, string, Data, Event> &
        WithDataBrand<Data> &
        WithErrorBrand<StepError>;
    },

    createWizard<const TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Partial<Omit<CreateWizardOptions<Context, Event, TDefs>, 'steps'>>
    ): EnhancedWizard<
      Context,
      keyof TDefs & string,
      DataMapFromDefs<TDefs>,
      Event,
      ErrorMapFromDefs<TDefs, DefaultError>
    > {
      return createWizardImpl({
        context: ({} as Context),
        ...options,
        steps,
      }) as EnhancedWizard<
        Context,
        keyof TDefs & string,
        DataMapFromDefs<TDefs>,
        Event,
        ErrorMapFromDefs<TDefs, DefaultError>
      >;
    },
  };
}
