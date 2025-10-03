/**
 * @wizard/react - React-specific Types
 * UI meta and component resolution types for React integration
 */

import * as React from 'react';
import { ValOrFn, StepArgs, PartialStepDefinition, InferStepData, WizardStep as CoreWizardStep } from '@wizard/core';

// ===== 1. UI Meta + Component (value-or-fn) + Resolver =====

export type ComponentLike = React.ComponentType<any> | React.ReactElement;

/**
 * React-enhanced wizard step with component support
 */
export interface ReactWizardStep<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> extends CoreWizardStep<StepName, Data, Context, AllSteps, DataMap> {
  readonly component: ComponentLike | undefined;
}

export type StepMetaUI<C, S extends string, Data, E> = {
  icon?: ValOrFn<React.ReactNode, StepArgs<C, S, Data, E>>;
  renderBadge?: ValOrFn<React.ReactNode, StepArgs<C, S, Data, E>>;
  uiExtra?: Record<string, unknown>;
};

export function resolveMetaUI<C, S extends string, Data, E>(
  meta: StepMetaUI<C, S, Data, E> | undefined,
  args: StepArgs<C, S, Data, E>
) {
  const r = <T>(v: ValOrFn<T, typeof args> | undefined): T | undefined =>
    typeof v === 'function' ? (v as any)(args) : v;
  return { icon: r(meta?.icon), renderBadge: r(meta?.renderBadge), uiExtra: meta?.uiExtra };
}

export type ReactStepDefinition<C, S extends string, E, TDef> =
  PartialStepDefinition<C, S, E, TDef> & {
    component?: ValOrFn<ComponentLike, StepArgs<C, S, InferStepData<TDef>, E>>;
    uiMeta?: StepMetaUI<C, S, InferStepData<TDef>, E>;
  };

export function resolveStepComponent<C, S extends string, Data, E>(
  comp: ValOrFn<ComponentLike, StepArgs<C, S, Data, E>> | undefined,
  args: StepArgs<C, S, Data, E>
): React.ReactElement | null {
  if (!comp) return null;

  // If it's already a React element, return it
  if (React.isValidElement(comp)) return comp;

  // If it's a function, we need to determine if it's:
  // 1. A React component (rendered as <Component />)
  // 2. A factory function that takes args and returns a component/element
  if (typeof comp === 'function') {
    // Check if it's a React component by checking function length
    // React components typically have length 0 or 1 (props)
    // Factory functions that take StepArgs have specific length
    const funcLength = comp.length;

    // If function takes 0 arguments, it's likely a React component
    if (funcLength === 0) {
      return React.createElement(comp as React.ComponentType<any>);
    }

    // Otherwise, call it as a factory function with args
    const value = (comp as any)(args);
    if (React.isValidElement(value)) return value;
    if (typeof value === 'function') {
      return React.createElement(value as React.ComponentType<any>);
    }
  }

  return null;
}