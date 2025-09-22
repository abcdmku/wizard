/**
 * Test Direct Wizard Creation
 * Bypass the factory to test the wizard implementation directly
 */

import { createWizard } from '../wizard';

// Define the step structure directly
const stepDefs = {
  step1: {
    data: { value: 42 },
    next: [] as string[]
  }
};

// Create wizard directly
const wizard = createWizard({
  context: { globalFlag: true },
  steps: stepDefs
});

// Test the getStep call
const stepWrapper = wizard.getStep('step1');
type StepWrapperType = typeof stepWrapper;

// Check the data property
const data = stepWrapper.data;
type DataType = typeof data;

// This should work if direct creation works
const value = stepWrapper.data?.value;

console.log('Direct wizard test value:', value);

export type DirectWizardTest = {
  StepWrapperType: StepWrapperType;
  DataType: DataType;
};