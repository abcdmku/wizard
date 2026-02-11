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
  type StepArgs,
  type StepMetaCore,
  type ValidateArgs,
  type ValOrFn,
  type WithDataBrand,
} from '@wizard/core';
import type { StepMetaUI } from './types';

type ReactStepDefinitionInput<C, S extends string, Data, E> = {
  next:
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
  component?: React.ComponentType<any>;
  uiMeta?: StepMetaUI<C, S, Data, E>;
};

export type ReactWizardInstance<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E = never
> = EnhancedWizard<C, S, D, E> & {
  getStepComponent: (stepName: S) => React.ComponentType<any> | undefined;
};

/**
 * Creates a React-aware wizard factory.
 */
export function createReactWizardFactory<C = Record<string, never>, E = never>() {
  const coreFactory = createCoreWizardFactory<C, E>();

  return {
    defineSteps<const T extends Record<string, any>>(defs: T): T {
      return defs;
    },

    step<Data>(
      definition: ReactStepDefinitionInput<C, string, Data, E>
    ): ReactStepDefinitionInput<C, string, Data, E> & WithDataBrand<Data> {
      return definition as ReactStepDefinitionInput<C, string, Data, E> &
        WithDataBrand<Data>;
    },

    createWizard<const TDefs extends Record<string, any>>(
      steps: TDefs,
      options?: Partial<Omit<CreateWizardOptions<C, E, TDefs>, 'steps'>>
    ): ReactWizardInstance<C, keyof TDefs & string, DataMapFromDefs<TDefs>, E> {
      const wizard = coreFactory.createWizard(steps, options);

      return Object.assign(wizard, {
        getStepComponent(stepName: keyof TDefs & string) {
          const definition = steps[stepName] as { component?: unknown } | undefined;
          if (!definition) {
            return undefined;
          }

          if (typeof definition.component === 'function') {
            return definition.component as React.ComponentType<any>;
          }

          return undefined;
        },
      });
    },
  };
}
