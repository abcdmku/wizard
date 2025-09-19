/**
 * @wizard/core - Deeply type-safe, isomorphic, headless multi-step wizard library
 */

export { createWizard } from './wizard';
export { createHelpers } from './helpers';
export * as selectors from './selectors';

export type {
  Wizard,
  WizardConfig,
  WizardState,
  WizardTransitionEvent,
  WizardPersistence,
  StepDefinition,
  StepDefinitionInfer,
  StepStatus,
  StepRuntime,
  WizardHelpers,
  StepMeta,
  // Type inference utilities
  InferSteps,
  InferDataMap,
  InferContext,
  InferStepData,
  InferValidatorData,
} from './types';