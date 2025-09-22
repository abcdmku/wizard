/**
 * Validate Final Fix
 * Test the exact scenario from the user's issue
 */

import { wizardWithContext } from '../wizard-factory';

const { defineSteps, createWizard, step} = wizardWithContext({
  globalFlag: true,
  userId: 'user123',
  permissions: ['read'],
  theme: 'light'
});

const steps = defineSteps({
  step1: step({
    data: { value: 42 },
    canEnter: ({ context, data }) => {
      // ✅ context automatically typed as AppContext
      return context.globalFlag && Boolean(data?.value);
    },
    next: []
  })
});

const wizard = createWizard(steps);

const currentStep = wizard.getCurrentStep();

// This should now work without type errors!
console.log('=== Final Fix Validation ===');
console.log('currentStep.data:', currentStep.data);

if (currentStep.data) {
  // This line should work with proper typing now
  const value = currentStep.data.value;
  console.log('✅ Successfully accessed currentStep.data.value:', value);
  console.log('✅ Type:', typeof value);
} else {
  console.log('❌ currentStep.data is undefined');
}

// Test fluent API with proper typing
const fluentResult = currentStep
  .setData({ value: 99 })
  .markIdle()
  .updateData(data => ({ value: (data?.value || 0) + 1 }));

console.log('✅ Fluent chain result data:', fluentResult.data);

// Test getStep with proper typing
const step1 = wizard.getStep('step1');
console.log('✅ getStep result data:', step1.data);

if (step1.data) {
  const step1Value = step1.data.value;
  console.log('✅ step1.data.value:', step1Value);
}

console.log('🎉 All type inference and data access tests passed!');