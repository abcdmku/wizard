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

// Re-export core types for convenience
export type {
  Wizard,
  WizardState,
  StepDefinition,
  StepStatus,
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
  ValidateArgs,
  StepMetaCore,
  JSONValue,
  ValOrFn,
} from '@wizard/core';