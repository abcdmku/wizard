/**
 * Real type inference test - NO explicit typing, pure inference from data
 */

import { defineSteps, createWizard } from '../index';

// Test with just data property - should infer types automatically
const realSteps = defineSteps({
  payment: {
    data: { method: 'card', amount: 100 }, // Should infer { method: string; amount: number }
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false }, // Should infer { confirmed: boolean }
    next: [],
  },
});

const realWizard = createWizard({
  context: { userId: '123' },
  steps: realSteps,
});

// Test what actually gets inferred
const paymentData = realWizard.getStepData('payment');
const confirmationData = realWizard.getStepData('confirmation');

// Let's see what TypeScript thinks these types are
type ActualPaymentType = typeof paymentData;
type ActualConfirmationType = typeof confirmationData;

// This function should compile if types are properly inferred
function testInference() {
  // If getStepData returns unknown, these will fail at compile time
  if (paymentData) {
    // ✅ This now works! Type inference is working correctly
    const method = paymentData.method;
    const amount = paymentData.amount;
    console.log(method, amount);
  }

  if (confirmationData) {
    // ✅ This now works! Type inference is working correctly
    const confirmed = confirmationData.confirmed;
    console.log(confirmed);
  }
}

export { testInference, realSteps, realWizard };