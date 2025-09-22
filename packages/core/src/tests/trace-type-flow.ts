/**
 * Trace Type Flow
 * Let's examine each step of the type flow to find where the types break
 */

import { wizardWithContext } from '../wizard-factory';
import type { EnhancedDataMapFromDefs } from '../types';

const { defineSteps, createWizard, step } = wizardWithContext({
  globalFlag: true,
});

// Step 1: Check step function result
const stepResult = step({
  data: { value: 42 },
  next: []
});

type StepResultType = typeof stepResult;

// Step 2: Check defineSteps result
const stepsResult = defineSteps({
  step1: stepResult
});

type StepsResultType = typeof stepsResult;

// Step 3: Check the data map extraction
type DataMapType = EnhancedDataMapFromDefs<StepsResultType>;

// Step 4: Check specific step data
type Step1DataType = DataMapType['step1'];

// Step 5: Check wizard creation
const wizard = createWizard(stepsResult);
type WizardType = typeof wizard;

// Let's trace each step
console.log('=== Type Flow Trace ===');
console.log('stepResult:', stepResult);
console.log('stepsResult:', stepsResult);
console.log('wizard keys:', Object.keys(wizard));

// Test the type assignments
const step1Data: Step1DataType = { value: 42 }; // This should work
console.log('step1Data:', step1Data);

export type TypeFlowTrace = {
  StepResultType: StepResultType;
  StepsResultType: StepsResultType;
  DataMapType: DataMapType;
  Step1DataType: Step1DataType;
  WizardType: WizardType;
};