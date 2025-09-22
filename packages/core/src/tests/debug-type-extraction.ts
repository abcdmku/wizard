/**
 * Debug Type Extraction
 * Let's test exactly what types are being extracted
 */

import { wizardWithContext } from '../wizard-factory';
import type { ExtractStepDataType, EnhancedDataMapFromDefs } from '../types';

// Test type extraction directly
type TestDefs = {
  step1: {
    data: { value: number };
    next: string[];
  };
};

// Test our type extraction
type ExtractedDataType = ExtractStepDataType<TestDefs, 'step1'>;
type DataMap = EnhancedDataMapFromDefs<TestDefs>;

// This should resolve to { value: number }
const test1: ExtractedDataType = { value: 42 };
const test2: DataMap['step1'] = { value: 42 };

console.log('Type extraction tests:');
console.log('test1:', test1);
console.log('test2:', test2);

// Now test the actual wizard factory
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

const wizard = createWizard(steps);

// Debug what we actually get
console.log('Debug wizard creation:');
console.log('Current step:', wizard.getCurrent());

const currentStep = wizard.getCurrentStep();
console.log('Current step wrapper:', currentStep);
console.log('Current step name:', currentStep.name);
console.log('Current step data:', currentStep.data);

// Test the type by accessing the property
try {
  // This should work if types are correct
  const value = (currentStep.data as any)?.value;
  console.log('Accessed value:', value);
} catch (error) {
  console.log('Type access error:', error);
}

// Debug the step definitions themselves
console.log('Steps object:', steps);
console.log('Step1 definition:', steps.step1);
console.log('Step1 data:', steps.step1.data);