/**
 * Test getStep call specifically
 */

import { wizardWithContext } from '../wizard-factory';

const { defineSteps, createWizard, step } = wizardWithContext({
  globalFlag: true,
});

const steps = defineSteps({
  step1: step({
    data: { value: 42 },
    next: []
  })
});

const wizard = createWizard(steps);

// This is the problematic call
const stepWrapper = wizard.getStep('step1');
type StepWrapperType = typeof stepWrapper;

// Check the data property
const data = stepWrapper.data;
type DataType = typeof data;

// This line should fail in TypeScript
const value = stepWrapper.data?.value;

export type GetStepTest = {
  StepWrapperType: StepWrapperType;
  DataType: DataType;
};