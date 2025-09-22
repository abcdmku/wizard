/**
 * Manual Type Test
 * Let's bypass the automatic inference and provide types manually
 */

import { wizardWithContext } from '../wizard-factory';
import type { WizardStep } from '../step-wrapper';

const { defineSteps, createWizard, step } = wizardWithContext({
  globalFlag: true,
});

const steps = defineSteps({
  step1: step({
    data: { value: 42 } as { value: number },  // Explicit typing
    next: []
  })
});

const wizard = createWizard(steps);

// Manual type assertion to test if the issue is in the automatic inference
const stepWrapper = wizard.getStep('step1') as WizardStep<
  'step1',
  { value: number },
  { globalFlag: boolean },
  'step1',
  { step1: { value: number } }
>;

// This should work if the issue is purely in type inference
const value = stepWrapper.data?.value;

console.log('Manual type test value:', value);

// Let's also test the automatic inference to compare
const autoWrapper = wizard.getStep('step1');
console.log('Auto wrapper data:', autoWrapper.data);

// This should fail in TypeScript but work at runtime
// const autoValue = autoWrapper.data?.value;

export type ManualTypeTest = {
  StepWrapperType: typeof stepWrapper;
  AutoWrapperType: typeof autoWrapper;
};