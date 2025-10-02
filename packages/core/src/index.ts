/**
 * @wizard/core - Isomorphic, deeply-typed wizard with inference-first authoring
 */

// Main factory and step definition
export { createWizard } from './wizard';
export { defineSteps } from './types';

// Step helper functions for proper type inference
export { step, stepWithValidation, dataStep, transitionStep, conditionalStep } from './step-helpers';

// Context-aware wizard factory for automatic context type inference
export { createWizardFactory, wizardWithContext } from './wizard-factory';

// Utility functions
export { resolve, resolveMetaCore } from './types';

// Core types
export type {
  // Factory types
  CreateWizardOptions,

  // Core wizard types
  Wizard,
  WizardState,
  WizardHelpers,

  // Step types
  StepDefinition,
  PartialStepDefinition,
  StepStatus,
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
  ValidateArgs,

  // Meta types
  StepMetaCore,

  // Utility types
  JSONValue,
  ValOrFn,

  // Inference types
  InferStepData,
  StepIds,
  DataMapFromDefs,
  EnhancedDataMapFromDefs,
  EnhancedWizard,
} from './types';

// Step wrapper types
export type { WizardStep } from './step-wrapper';