/**
 * @wizard/react - React-specific Types
 * UI meta and component resolution types for React integration
 */

import * as React from 'react';
import { ValOrFn, StepArgs, PartialStepDefinition, InferStepData } from '@wizard/core';

// ===== 1. UI Meta + Component (value-or-fn) + Resolver =====

export type ComponentLike = React.ComponentType<any> | React.ReactElement;

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
  const value = typeof comp === 'function' ? (comp as any)(args) : comp;
  if (React.isValidElement(value)) return value;
  if (typeof value === 'function') return React.createElement(value as React.ComponentType<any>, { args });
  return null;
}