/**
 * @wizard/react - React-specific Types
 * UI meta and component resolution types for React integration
 */

import * as React from 'react';
import type {
  InferStepData,
  PartialStepDefinition,
  StepArgs,
  ValOrFn,
  Wizard,
  WizardStep as CoreWizardStep,
} from '@wizard/core';

// ===== 1. UI Meta + Component (value-or-fn) + Resolver =====

/**
 * React-enhanced wizard step with component support
 */
export interface ReactWizardStep<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>,
  ErrorMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> extends CoreWizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
  readonly component: React.ReactNode;
}

export type StepComponentProps<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  K extends S = S,
  EM extends Record<S, unknown> = Record<S, unknown>
> = {
  step: ReactWizardStep<K, D[K], C, S, D, EM>;
  data: D[K] | undefined;
  wizardData: Partial<D>;
  context: Readonly<C>;
  wizard: Wizard<C, S, D, E, EM>;
};

export type StepComponent<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  K extends S = S,
  EM extends Record<S, unknown> = Record<S, unknown>
> = React.ComponentType<StepComponentProps<C, S, D, E, K, EM>>;

export type StepMetaUI<C, S extends string, Data, E> = {
  icon?: ValOrFn<React.ReactNode, StepArgs<C, S, Data, E>>;
  renderBadge?: ValOrFn<React.ReactNode, StepArgs<C, S, Data, E>>;
  uiExtra?: Record<string, unknown>;
};

export function resolveMetaUI<C, S extends string, Data, E>(
  meta: StepMetaUI<C, S, Data, E> | undefined,
  args: StepArgs<C, S, Data, E>
) {
  const r = <T>(v: ValOrFn<T, typeof args> | undefined): T | undefined => {
    if (typeof v === 'function') {
      return (v as (input: typeof args) => T)(args);
    }
    return v;
  };
  return { icon: r(meta?.icon), renderBadge: r(meta?.renderBadge), uiExtra: meta?.uiExtra };
}

export type ReactStepDefinition<C, S extends string, E, TDef> =
  PartialStepDefinition<C, S, E, TDef> & {
    component?: React.ComponentType<
      StepComponentProps<
        C,
        S,
        Record<S, InferStepData<TDef>>,
        E,
        S,
        Record<S, unknown>
      >
    >;
    uiMeta?: StepMetaUI<C, S, InferStepData<TDef>, E>;
  };

export function resolveStepComponent<Props extends object>(
  component: React.ComponentType<Props> | undefined,
  props: Props
): React.ReactNode {
  if (!component) {
    return null;
  }
  return React.createElement(component, props);
}
