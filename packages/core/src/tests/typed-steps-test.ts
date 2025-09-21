/**
 * Test defineTypedSteps for better callback argument typing
 */

import { defineTypedSteps, createWizard } from '../index';

// Define context type
type OrderContext = {
  orderId: string;
  customerId: string;
  totalAmount: number;
};

// Use defineTypedSteps with explicit context type
const defineOrderSteps = defineTypedSteps<OrderContext>();

const typedSteps = defineOrderSteps({
  init: {
    data: { orderId: '', customerId: '', totalAmount: 0 },
    beforeExit: ({ data, ctx, updateContext }) => {
      // These should now be properly typed:
      // data: { orderId: string; customerId: string; totalAmount: number }
      // ctx: Readonly<OrderContext>
      // updateContext: (fn: (ctx: OrderContext) => void) => void

      const orderId: string = data.orderId; // Should work
      const customerId: string = data.customerId; // Should work
      const totalAmount: number = data.totalAmount; // Should work

      updateContext((context) => {
        // context should be typed as OrderContext
        context.orderId = data.orderId;
        context.customerId = data.customerId;
        context.totalAmount = data.totalAmount;
      });

      console.log(`✓ Order initialized: ${orderId}`);
    },
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false },
    beforeExit: ({ data, ctx }) => {
      // data: { confirmed: boolean }
      // ctx: Readonly<OrderContext>

      const confirmed: boolean = data.confirmed; // Should work
      const orderId: string = ctx.orderId; // Should work from context

      console.log(`Order ${orderId} confirmed: ${confirmed}`);
    },
    next: [],
  },
});

// Test with wizard creation
const typedWizard = createWizard({
  context: { orderId: '', customerId: '', totalAmount: 0 } as OrderContext,
  steps: typedSteps,
});

export { typedSteps, typedWizard };