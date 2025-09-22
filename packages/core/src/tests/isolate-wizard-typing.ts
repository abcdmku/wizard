/**
 * Isolate Wizard Typing Issue
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

// Check the type of steps
type StepsType = typeof steps;

// Check what createWizard returns
const wizard = createWizard(steps);
type WizardType = typeof wizard;

// Check if the issue is in getStep
const stepWrapper = wizard.getStep('step1');
type StepWrapperType = typeof stepWrapper;

// Check the data property specifically
const data = stepWrapper.data;
type DataType = typeof data;

// Let's see if the issue is that we need optional chaining
if (stepWrapper.data) {
  // Inside this block, data should be non-undefined
  type DataInBlock = typeof stepWrapper.data;

  // This should work if types are correct
  const value = stepWrapper.data.value;
  type ValueType = typeof value;

  console.log('Value accessed successfully:', value);
}

console.log('Wizard typing isolation test completed');

export type IsolationTypes = {
  StepsType: StepsType;
  WizardType: WizardType;
  StepWrapperType: StepWrapperType;
  DataType: DataType;
};