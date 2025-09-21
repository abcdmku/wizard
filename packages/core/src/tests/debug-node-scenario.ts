/**
 * Debug the exact scenario from node-saga-wizard
 */

import { defineSteps } from '../index';

// Exact pattern from node-saga-wizard
const validateInit = ({ data }: { data: unknown }) => {
  console.log(data);
};

// Test this exact scenario
const debugNodeSteps = defineSteps({
  init: {
    validate: validateInit,
    data: { orderId: '', customerId: '', totalAmount: 0 },
    beforeExit: ({ data, updateContext }) => {
      // This should work now!
      const orderId: string = data.orderId;
      const customerId: string = data.customerId;
      const totalAmount: number = data.totalAmount;

      updateContext(() => {
        console.log(`Order: ${orderId}, Customer: ${customerId}, Amount: ${totalAmount}`);
      });
    },
  },
});

// Check the types
type StepsType = typeof debugNodeSteps;
type InitType = StepsType['init'];
type BeforeExitType = InitType['beforeExit'];

export { debugNodeSteps, type BeforeExitType };