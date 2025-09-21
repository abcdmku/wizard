/**
 * Core type inference verification - simple test to verify main issues are resolved
 * This file verifies that getStepData() returns properly typed data (not unknown)
 *
 * NOTE: For proper callback typing, use the helper functions:
 * - step() for basic typed steps
 * - stepWithValidation() for steps with validation
 */

import { defineSteps, createWizard, step, stepWithValidation } from '../index';

// Test case: Basic wizard with typed step data using validate functions
const testSteps = defineSteps({
  payment: {
    validate: ({ data }: { data: { method: string; amount: number } }) => {
      if (!data.method || data.amount <= 0) throw new Error('Invalid payment');
    },
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }) => {
      // Test callback typing - should be properly typed now!
      const method: string = data.method; // This should work!
      const amount: number = data.amount;  // This should work!
      console.log(`Payment: ${method} for $${amount}`);
    },
    canExit: ({ data }) => {
      // Test canExit callback typing
      const method: string = data.method; // This should work!
      const amount: number = data.amount;  // This should work!
      return amount > 0;
    },
    canEnter: ({ data }) => {
      // Test canEnter callback typing
      const method: string = data.method; // This should work!
      return method.length > 0;
    },
    complete: ({ data }) => {
      // Test complete callback typing
      const method: string = data.method; // This should work!
      const amount: number = data.amount;  // This should work!
      return method === 'card' && amount > 0;
    },
    next: ['confirmation'],
  },
  confirmation: {
    validate: ({ data }: { data: { confirmed: boolean } }) => {
      // validation logic
    },
    data: { confirmed: false },
    beforeExit: ({ data }) => {
      // Test callback typing from validate function
      const confirmed: boolean = data.confirmed; // This should work!
      console.log(`Confirmed: ${confirmed}`);
    },
    next: [],
  },
});

const testWizard = createWizard({
  context: { userId: '123' },
  steps: testSteps,
});

// Let's check what types are being inferred
type TestStepsType = typeof testSteps;
type DataMapType = import('../types').DataMapFromDefs<TestStepsType>;

// Critical test: getStepData should return proper types, not unknown
const paymentData = testWizard.getStepData('payment');
const confirmationData = testWizard.getStepData('confirmation');

// Debug: Let's see what the actual types are
type PaymentDataType = typeof paymentData; // Should be { method: string; amount: number } | undefined
type ConfirmationDataType = typeof confirmationData; // Should be { confirmed: boolean } | undefined

// These assertions would fail at compile time if types are still unknown
function verifyTypes() {
  if (paymentData) {
    // This should work - accessing method property on payment data
    const method: string = paymentData.method;
    const amount: number = paymentData.amount;
    console.log(`Payment method: ${method}, amount: ${amount}`);
  }

  if (confirmationData) {
    // This should work - accessing confirmed property on confirmation data
    const confirmed: boolean = confirmationData.confirmed;
    console.log(`Confirmed: ${confirmed}`);
  }
}

export const CORE_TYPE_INFERENCE_WORKS = true;
export { verifyTypes };

// WORKING SOLUTION: Using helper functions for proper callback typing
const workingSteps = defineSteps({
  payment: step({
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }) => {
      // ✅ This WORKS - data is properly typed!
      const method: string = data.method;
      const amount: number = data.amount;
      console.log(`Payment: ${method} for $${amount}`);
    },
    canExit: ({ data }) => {
      // ✅ This WORKS - data is properly typed!
      const amount: number = data.amount;
      return amount > 0;
    },
    next: ['confirmation'],
  }),

  confirmation: step({
    data: { confirmed: false },
    beforeExit: ({ data }) => {
      // ✅ This WORKS - data is properly typed!
      const confirmed: boolean = data.confirmed;
      console.log(`Confirmed: ${confirmed}`);
    },
    next: [],
  })
});

export { workingSteps };