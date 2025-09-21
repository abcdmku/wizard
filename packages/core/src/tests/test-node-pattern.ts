/**
 * Test the exact pattern from node-saga-wizard
 */

import { defineSteps } from '../index';

// Simulate the exact pattern
const validateInit = ({ data }: { data: unknown }) => {
  // Zod validation would go here
  console.log(data);
};

const testNodePattern = defineSteps({
  init: {
    validate: validateInit,
    data: { orderId: '', customerId: '', totalAmount: 0 },
    beforeExit: ({ data, updateContext }) => {
      // What happens here?
      const orderId: string = data.orderId;        // Does this work?
      const customerId: string = data.customerId; // Does this work?
      const totalAmount: number = data.totalAmount; // Does this work?

      updateContext(() => {
        console.log(`Order: ${orderId}, Customer: ${customerId}, Amount: ${totalAmount}`);
      });
    },
    next: ['reserve'],
  },
});

// Also test without validate
const testWithoutValidate = defineSteps({
  init: {
    data: { orderId: '', customerId: '', totalAmount: 0 },
    beforeExit: ({ data, updateContext }) => {
      // This should definitely work
      const orderId: string = data.orderId;
      const customerId: string = data.customerId;
      const totalAmount: number = data.totalAmount;

      updateContext(() => {
        console.log(`Order: ${orderId}, Customer: ${customerId}, Amount: ${totalAmount}`);
      });
    },
    next: ['reserve'],
  },
});

export { testNodePattern, testWithoutValidate };