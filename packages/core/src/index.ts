/**
 * @wizard/core - Isomorphic, deeply typed wizard with inference-first authoring.
 */

export { createWizard } from './wizard';
export { defineSteps } from './types';

export { step, stepWithValidation } from './step-helpers';

export { createWizardFactory } from './wizard-factory';

export { resolve, resolveMetaCore } from './types';

export type {
  CreateWizardOptions,
  Wizard,
  WizardState,
  WizardHelpers,
  StepDefinition,
  PartialStepDefinition,
  StepStatus,
  StepArgs,
  StepEnterArgs,
  StepExitArgs,
  ValidateArgs,
  StepMetaCore,
  JSONValue,
  ValOrFn,
  InferStepData,
  StepIds,
  DataMapFromDefs,
  EnhancedDataMapFromDefs,
  EnhancedWizard,
  DataTypeOf,
  WithDataBrand,
  WithErrorBrand,
  ErrorTypeOf,
  ErrorMapFromDefs,
  // compatibility exports
  WizardConfig,
  WizardTransitionEvent,
  WizardPersistence,
  InferContext,
  InferSteps,
  InferDataMap,
  StepRuntime,
} from './types';

export type { WizardStep } from './step-wrapper';
