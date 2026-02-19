/**
 * @wizard/react - React adapter for @wizard/core
 * Provides hooks and components for type-safe multi-step wizards in React
 */

// Context and Provider
export { WizardProvider } from './context';
export type { WizardProviderProps } from './context';

// Core hooks
export {
  useWizard,
  useCurrentStep,
  useWizardStep,
  useWizardProgress,
  useWizardActions,
  useWizardHelpers,
  useStepError,
  useWizardSelector,
} from './hooks';

// React-specific factory
export { createReactWizardFactory } from './factory';
export type { ReactWizardInstance } from './factory';

// Router integration
export { useSyncWizardWithRouter } from './router';
export type { SyncWizardWithRouterOptions } from './router';
export { useTanStackWizardRouter } from './tanstack-router';
export type { TanStackWizardRouterOptions } from './tanstack-router';

// React-specific types
export type {
  ReactWizardStep,
  StepMetaUI,
  ReactStepDefinition,
  StepComponent,
  StepComponentProps,
} from './types';

// Re-export core types for convenience
export type {
  Wizard,
  WizardState,
  WizardStep,
  StepDefinition,
  StepStatus,
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
  ValidateArgs,
  StepMetaCore,
  JSONValue,
  ValOrFn,
  WithErrorBrand,
  ErrorTypeOf,
  ErrorMapFromDefs,
} from '@wizard/core';
