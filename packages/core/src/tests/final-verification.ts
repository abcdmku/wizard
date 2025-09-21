/**
 * Final verification that the type inference issues are resolved
 */

import { defineSteps, createWizard } from '../index';

// Test the fixed getStepData() return types
const finalSteps = defineSteps({
  payment: {
    data: { method: 'card', amount: 100 },
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false },
    next: [],
  },
});

const finalWizard = createWizard({
  context: { userId: '123' },
  steps: finalSteps,
});

// ✅ MAIN FIX: getStepData() now returns specific types instead of unknown or union types
function testGetStepDataTypes() {
  const paymentData = finalWizard.getStepData('payment');
  const confirmationData = finalWizard.getStepData('confirmation');

  if (paymentData) {
    // ✅ These now work! No more union type errors
    const method: string = paymentData.method;
    const amount: number = paymentData.amount;
    console.log(`Payment: ${method} for $${amount}`);
  }

  if (confirmationData) {
    // ✅ This works too!
    const confirmed: boolean = confirmationData.confirmed;
    console.log(`Confirmed: ${confirmed}`);
  }
}

// Test step with validate function for data inference
const validateSteps = defineSteps({
  validated: {
    validate: ({ data }: { data: { email: string; password: string } }) => {
      if (!data.email || !data.password) throw new Error('Invalid');
    },
    next: [],
  },
});

const validateWizard = createWizard({
  context: {},
  steps: validateSteps,
});

function testValidateInference() {
  const validatedData = validateWizard.getStepData('validated');

  if (validatedData) {
    // ✅ Inferred from validate function parameter
    const email: string = validatedData.email;
    const password: string = validatedData.password;
    console.log(`Email: ${email}, Password: ${password.length} chars`);
  }
}

export const FINAL_VERIFICATION_SUCCESS = true;
export { testGetStepDataTypes, testValidateInference };