/**
 * Test the actual callback typing with the new system
 */

import { defineSteps } from '../index';

// Test with validate function
const testValidate = defineSteps({
  payment: {
    validate: ({ data }: { data: { method: string; amount: number } }) => {
      if (!data.method || data.amount <= 0) throw new Error('Invalid payment');
    },
    // Add a callback to test typing
    beforeExit: ({ data }) => {
      // Let's see what type 'data' has here
      const method = data.method; // Is this typed correctly?
      const amount = data.amount; // Is this typed correctly?
      console.log(method, amount);
    },
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false },
    beforeExit: ({ data }) => {
      // Test data property inference
      const confirmed = data.confirmed; // Is this typed correctly?
      console.log(confirmed);
    },
    next: [],
  },
});

export { testValidate };