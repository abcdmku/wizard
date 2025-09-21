/**
 * Reproduction test - create the exact scenario that should show proper typing
 */

import { defineSteps } from '../index';

// Create the exact scenario where we want to see proper type inference
const validateInit = ({ data }: { data: unknown }) => {
  console.log(data);
};

const steps = defineSteps({
  init: {
    validate: validateInit,
    data: { orderId: '', customerId: '', totalAmount: 0 },
    next: ['reserve'],
    beforeExit: ({ data, updateContext }) => {
      // In the IDE, hover over 'data' parameter here
      // It should show: data: { orderId: string; customerId: string; totalAmount: number }
      // NOT: data: any

      // These assignments should work without type errors
      const orderId: string = data.orderId;
      const customerId: string = data.customerId;
      const totalAmount: number = data.totalAmount;

      updateContext(() => {
        console.log(`Order: ${orderId}, Customer: ${customerId}, Amount: ${totalAmount}`);
      });
    },
    canExit: ({ data }) => {
      // In the IDE, hover over 'data' parameter here
      // It should show: data: { orderId: string; customerId: string; totalAmount: number }
      const totalAmount: number = data.totalAmount;
      return totalAmount > 0;
    },
    complete: ({ data }) => {
      // Same here - should be properly typed
      const orderId: string = data.orderId;
      return orderId.length > 0;
    },
  },
  reserve: {
    validate: ({ data }: { data: unknown }) => {
      console.log(data);
    },
    data: { items: [] as Array<{ sku: string; quantity: number }> },
    beforeExit: ({ data, updateContext }) => {
      // Should infer: data: { items: Array<{ sku: string; quantity: number }> }
      const items: Array<{ sku: string; quantity: number }> = data.items;

      updateContext(() => {
        console.log(`Items: ${items.length}`);
      });
    },
    next: [],
  },
});

// Check what the actual types are
type StepsType = typeof steps;
type InitType = StepsType['init'];
type ReserveType = StepsType['reserve'];

// These type assertions should pass if typing is working
type InitBeforeExitType = InitType['beforeExit'];
type InitCanExitType = InitType['canExit'];
type InitCompleteType = InitType['complete'];

export {
  steps,
  type StepsType,
  type InitType,
  type ReserveType,
  type InitBeforeExitType,
  type InitCanExitType,
  type InitCompleteType
};