/**
 * Test data property inference specifically
 */

import { defineSteps } from '../index';

// Test case similar to node-saga-wizard
const testDataInference = defineSteps({
  init: {
    data: { orderId: '', customerId: '', totalAmount: 0 },
    beforeExit: ({ data, updateContext }) => {
      // This should work from data property inference
      const orderId: string = data.orderId;
      const customerId: string = data.customerId;
      const totalAmount: number = data.totalAmount;

      updateContext(() => {
        console.log(`Order: ${orderId}, Customer: ${customerId}, Amount: ${totalAmount}`);
      });
    },
    next: ['reserve'],
  },
  reserve: {
    data: { items: [] as Array<{ sku: string; quantity: number }> },
    beforeExit: ({ data }) => {
      // This should work from data property inference
      const items: Array<{ sku: string; quantity: number }> = data.items;
      console.log(`Items: ${items.length}`);
    },
    next: [],
  },
});

export { testDataInference };