/**
 * Test by bypassing defineSteps to see if that's the issue
 */

import { createWizard } from '../index';

// Create steps directly without defineSteps
const directSteps = {
  payment: {
    data: { method: 'card', amount: 100 },
    next: ['confirmation' as const],
  },
  confirmation: {
    data: { confirmed: false },
    next: [] as const,
  },
} as const;

const directWizard = createWizard({
  context: { userId: '123' },
  steps: directSteps,
});

// Test getStepData
const directPaymentData = directWizard.getStepData('payment');
const directConfirmationData = directWizard.getStepData('confirmation');

// Can we access the properties?
function testDirectAccess() {
  if (directPaymentData) {
    // @ts-ignore - see what error we get
    const method = directPaymentData.method;
    // @ts-ignore
    const amount = directPaymentData.amount;
    console.log(method, amount);
  }

  if (directConfirmationData) {
    // @ts-ignore
    const confirmed = directConfirmationData.confirmed;
    console.log(confirmed);
  }
}

export { testDirectAccess };