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
  useWizardState,
  useWizardStep,
  useWizardSharedContext,
  useStepData,
  useCurrentStepData,
  useWizardLoading,
  useWizardTransitioning,
  useWizardHistory,
  useWizardErrors,
  useWizardActions,
} from './hooks';

// Router integration
export {
  useSyncWizardWithRouter,
  useTanStackRouterSync,
} from './router';
export type { SyncWizardWithRouterOptions } from './router';

// Re-export core types for convenience
export type {
  Wizard,
  WizardConfig,
  WizardState,
  WizardTransitionEvent,
  WizardPersistence,
  StepDefinition,
} from '@wizard/core';