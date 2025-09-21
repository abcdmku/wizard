/**
 * Test the EXACT node-saga-wizard pattern to debug the issue
 */

import { defineSteps } from '../index';

// EXACT pattern from node-saga-wizard
const validateInit = ({ data }: { data: unknown }) => {
  console.log('Validating:', data);
};

// This is the exact structure that fails in node-saga-wizard
const steps = defineSteps({
  init: {
    validate: validateInit,
    data: { orderId: '', customerId: '', totalAmount: 0 },
    next: ['reserve'],
    beforeExit: ({ data, updateContext }) => {
      // HOVER TEST: Check if data is properly typed here
      updateContext((ctx: any) => {
        ctx.orderId = data.orderId;      // This should work
        ctx.customerId = data.customerId; // This should work
        ctx.totalAmount = data.totalAmount; // This should work
      });
      console.log('✓ Order initialized:', data.orderId);
    },
    meta: {
      label: 'Initialize Order',
      category: 'order-management',
      description: 'Create a new order with customer and amount details',
    },
  },
  reserve: {
    validate: ({ data }: { data: unknown }) => {
      console.log('Reserve validation:', data);
    },
    data: { items: [] as Array<{ sku: string; quantity: number }> },
    next: ['charge'],
    canEnter: ({ ctx }: { ctx: any }) => Boolean(ctx.orderId),
    beforeExit: async ({ data, updateContext }) => {
      // HOVER TEST: Check if data is properly typed here
      console.log('  Reserving inventory for items:', data.items);
      await new Promise(resolve => setTimeout(resolve, 1000));

      updateContext((ctx: any) => {
        ctx.inventoryReserved = true;
      });
      console.log('✓ Inventory reserved');
    },
    meta: {
      label: 'Reserve Inventory',
      category: 'inventory-management',
      description: 'Reserve inventory for order items',
    },
  },
});

// Let's check the types that are actually inferred
type StepsType = typeof steps;
type InitStepType = StepsType['init'];
type ReserveStepType = StepsType['reserve'];

// Check the beforeExit function types
type InitBeforeExitType = InitStepType['beforeExit'];
type ReserveBeforeExitType = ReserveStepType['beforeExit'];

export {
  steps,
  type StepsType,
  type InitStepType,
  type ReserveStepType,
  type InitBeforeExitType,
  type ReserveBeforeExitType
};