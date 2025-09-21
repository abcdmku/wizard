/**
 * Test to check actual inferred types - check hover information in IDE
 */

import { defineSteps, createWizard } from '../index';

const testSteps = defineSteps({
  payment: {
    data: { method: 'card', amount: 100 },
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false },
    next: [],
  },
});

const wizard = createWizard({
  context: { userId: '123' },
  steps: testSteps,
});

// Hover over these variables to see their types:
const paymentResult = wizard.getStepData('payment');
const confirmationResult = wizard.getStepData('confirmation');

// Try to access properties and see what errors we get:
function testAccess() {
  if (paymentResult) {
    // What type is paymentResult here?
    const test1 = paymentResult; // Hover to see type

    // Try to access payment-specific properties
    // @ts-ignore - Let's see what the actual error is
    const method = paymentResult.method;
    // @ts-ignore
    const amount = paymentResult.amount;
  }

  if (confirmationResult) {
    // What type is confirmationResult here?
    const test2 = confirmationResult; // Hover to see type

    // Try to access confirmation-specific properties
    // @ts-ignore
    const confirmed = confirmationResult.confirmed;
  }
}

export { testAccess };