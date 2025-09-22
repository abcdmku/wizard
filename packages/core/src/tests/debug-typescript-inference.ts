/**
 * Debug TypeScript Type Inference
 * Let's see exactly what TypeScript is inferring
 */

import { wizardWithContext } from '../wizard-factory';

const { defineSteps, createWizard, step } = wizardWithContext({
  globalFlag: true,
  userId: 'user123',
  permissions: ['read'],
  theme: 'light'
});

const steps = defineSteps({
  step1: step({
    data: { value: 42 },
    canEnter: ({ context, data }) => {
      return context.globalFlag && Boolean(data?.value);
    },
    next: []
  })
});

// Let's check what TypeScript infers for these types
type StepsType = typeof steps;
type WizardType = ReturnType<typeof createWizard>;

const wizard = createWizard(steps);

// Debug the wizard type
type WizardInferred = typeof wizard;

// Debug the step wrapper types
const currentStep = wizard.getCurrentStep();
type CurrentStepType = typeof currentStep;

const step1 = wizard.getStep('step1');
type Step1Type = typeof step1;

// Try to access data and see what TypeScript thinks
const data = step1.data;
type DataType = typeof data;

// Export for inspection
export type TypeDebug = {
  StepsType: StepsType;
  WizardType: WizardType;
  WizardInferred: WizardInferred;
  CurrentStepType: CurrentStepType;
  Step1Type: Step1Type;
  DataType: DataType;
};

console.log('Type inference debug:');
console.log('steps:', steps);
console.log('wizard type keys:', Object.keys(wizard));
console.log('currentStep:', currentStep);
console.log('step1:', step1);
console.log('step1.data:', step1.data);

// Test runtime vs compile time
if (step1.data) {
  console.log('Runtime value:', (step1.data as any).value);
  // This should give a compile error if types are wrong:
  // const value: number = step1.data.value; // Uncomment to test
}