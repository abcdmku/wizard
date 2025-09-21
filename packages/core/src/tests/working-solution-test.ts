/**
 * Working solution using helper functions for proper type inference
 */

import { defineSteps, step, stepWithValidation } from '../index';

// Option 1: Using the step helper for proper typing
const typedSteps = defineSteps({
  payment: step({
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }) => {
      // data is properly typed as { method: string; amount: number }
      const method: string = data.method;
      const amount: number = data.amount;
      console.log(`Payment: ${method} for $${amount}`);
    },
    canExit: ({ data }) => {
      // data is properly typed as { method: string; amount: number }
      const amount: number = data.amount;
      return amount > 0;
    },
    complete: ({ data }) => {
      // data is properly typed as { method: string; amount: number }
      const method: string = data.method;
      const amount: number = data.amount;
      return method === 'card' && amount > 0;
    },
    next: ['confirmation'],
  }),

  confirmation: step({
    data: { confirmed: false },
    beforeExit: ({ data }) => {
      // data is properly typed as { confirmed: boolean }
      const confirmed: boolean = data.confirmed;
      console.log(`Confirmed: ${confirmed}`);
    },
    canExit: ({ data }) => {
      // data is properly typed as { confirmed: boolean }
      const confirmed: boolean = data.confirmed;
      return confirmed;
    },
    next: [],
  })
});

// Option 2: Using stepWithValidation for steps that need validation
const validatePayment = ({ data }: { data: { method: string; amount: number } }) => {
  if (!data.method || data.amount <= 0) throw new Error('Invalid payment');
};

const validatedSteps = defineSteps({
  payment: stepWithValidation(validatePayment, {
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }) => {
      // data is properly typed from the validation function
      const method: string = data.method;
      const amount: number = data.amount;
      console.log(`Payment: ${method} for $${amount}`);
    },
    canExit: ({ data }) => {
      const amount: number = data.amount;
      return amount > 0;
    },
    next: ['confirmation'],
  }),

  confirmation: step({
    data: { confirmed: false },
    beforeExit: ({ data }) => {
      const confirmed: boolean = data.confirmed;
      console.log(`Confirmed: ${confirmed}`);
    },
    next: [],
  })
});

// Test that these work
const step1Data = typedSteps.payment.data;
const step2Data = typedSteps.confirmation.data;

// Verify types are properly inferred
type PaymentDataType = typeof step1Data; // Should be { method: string; amount: number }
type ConfirmationDataType = typeof step2Data; // Should be { confirmed: boolean }

export {
  typedSteps,
  validatedSteps,
  type PaymentDataType,
  type ConfirmationDataType
};