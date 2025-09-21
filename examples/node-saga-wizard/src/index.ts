#!/usr/bin/env node
/**
 * Node.js CLI wizard example - demonstrates usage without React
 * Simulates an order processing saga with multiple steps using new PRP API
 */

import { createWizard, defineSteps } from '@wizard/core';
import { z } from 'zod';
import readline from 'readline/promises';

// Validation schemas
const initSchema = z.object({
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  totalAmount: z.number().positive(),
});

const reserveSchema = z.object({
  items: z.array(z.object({
    sku: z.string(),
    quantity: z.number().positive(),
  })).min(1),
});

const chargeSchema = z.object({
  paymentMethod: z.enum(['card', 'paypal']),
  confirmed: z.boolean(),
});

const notifySchema = z.object({
  email: z.string().email(),
});

const completeSchema = z.object({
  confirmed: z.boolean(),
});

// Validation functions using the new pattern
const validateInit = ({ data }: { data: unknown }) => {
  initSchema.parse(data);
};

const validateReserve = ({ data }: { data: unknown }) => {
  reserveSchema.parse(data);
};

const validateCharge = ({ data }: { data: unknown }) => {
  chargeSchema.parse(data);
};

const validateNotify = ({ data }: { data: unknown }) => {
  notifySchema.parse(data);
};

const validateComplete = ({ data }: { data: unknown }) => {
  completeSchema.parse(data);
};

// Define steps with inference-first pattern
const steps = defineSteps({
  init: {
    validate: validateInit,
    data: { orderId: '', customerId: '', totalAmount: 0 },
    next: ['reserve'],
    beforeExit: ({ data, updateContext }: {
      data: { orderId: string; customerId: string; totalAmount: number };
      updateContext: (fn: (ctx: any) => void) => void;
    }) => {
      updateContext((ctx: any) => {
        ctx.orderId = data.orderId;
        ctx.customerId = data.customerId;
        ctx.totalAmount = data.totalAmount;
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
    validate: validateReserve,
    data: { items: [] as Array<{ sku: string; quantity: number }> },
    next: ['charge'],
    canEnter: ({ ctx }: { ctx: any }) => Boolean(ctx.orderId),
    beforeExit: async ({ data, updateContext }: { data: any; updateContext: any }) => {
      // Simulate inventory reservation
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
  charge: {
    validate: validateCharge,
    data: { paymentMethod: 'card' as 'card' | 'paypal', confirmed: false },
    next: ['notify'],
    canEnter: ({ ctx }: { ctx: any }) => ctx.inventoryReserved,
    beforeExit: async ({ data, ctx, updateContext }: { data: any; ctx: any; updateContext: any }) => {
      if (!data.confirmed) {
        throw new Error('Payment not confirmed');
      }

      // Simulate payment processing
      console.log(`  Processing ${data.paymentMethod} payment for $${ctx.totalAmount}`);
      await new Promise(resolve => setTimeout(resolve, 1500));

      const paymentId = `PAY-${Date.now()}`;
      updateContext((ctx: any) => {
        ctx.paymentId = paymentId;
      });
      console.log('✓ Payment processed:', paymentId);
    },
    meta: {
      label: 'Process Payment',
      category: 'payment-processing',
      description: 'Charge customer payment method',
    },
  },
  notify: {
    validate: validateNotify,
    data: { email: '' },
    next: ['complete'],
    canEnter: ({ ctx }: { ctx: any }) => Boolean(ctx.paymentId),
    beforeExit: async ({ data, updateContext }: { data: any; updateContext: any }) => {
      // Simulate sending email
      console.log(`  Sending order confirmation to ${data.email}`);
      await new Promise(resolve => setTimeout(resolve, 800));

      updateContext((ctx: any) => {
        ctx.emailSent = true;
      });
      console.log('✓ Notification sent');
    },
    meta: {
      label: 'Send Notification',
      category: 'communication',
      description: 'Send order confirmation email to customer',
    },
  },
  complete: {
    validate: validateComplete,
    data: { confirmed: false },
    next: [],
    canEnter: ({ ctx }: { ctx: any }) => ctx.emailSent,
    beforeExit: ({ data, ctx }: { data: any; ctx: any }) => {
      if (!data.confirmed) {
        throw new Error('Order not confirmed');
      }
      console.log('✓ Order completed successfully!');
      console.log('  Final state:', {
        orderId: ctx.orderId,
        customerId: ctx.customerId,
        paymentId: ctx.paymentId,
        totalAmount: ctx.totalAmount,
      });
    },
    meta: {
      label: 'Complete Order',
      category: 'order-management',
      description: 'Finalize the order processing',
    },
  },
});

// Create wizard with inference
const orderWizard = createWizard({
  context: {
    orderId: '',
    customerId: '',
    inventoryReserved: false,
    paymentId: '',
    emailSent: false,
    totalAmount: 0,
    error: '',
  },
  steps,
  onStatusChange: ({ step, next }) => {
    console.log(`\n→ Step ${step} status: ${next}`);
  },
});

// CLI interface
async function runCLI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\n=== Order Processing Wizard ===\n');

  try {
    // Step 1: Initialize order
    console.log('Step 1: Initialize Order');
    const orderId = await rl.question('Order ID: ');
    const customerId = await rl.question('Customer ID: ');
    const totalAmount = parseFloat(await rl.question('Total Amount ($): '));

    await orderWizard.next({
      data: { orderId, customerId, totalAmount },
    });

    // Step 2: Reserve inventory
    console.log('\nStep 2: Reserve Inventory');
    const itemCount = parseInt(await rl.question('Number of items: '));
    const items = [];
    for (let i = 0; i < itemCount; i++) {
      const sku = await rl.question(`  Item ${i + 1} SKU: `);
      const quantity = parseInt(await rl.question(`  Item ${i + 1} Quantity: `));
      items.push({ sku, quantity });
    }

    await orderWizard.next({
      data: { items },
    });

    // Step 3: Process payment
    console.log('\nStep 3: Process Payment');
    const paymentMethod = await rl.question('Payment method (card/paypal): ') as 'card' | 'paypal';
    const paymentConfirm = await rl.question('Confirm payment? (yes/no): ');

    await orderWizard.next({
      data: {
        paymentMethod,
        confirmed: paymentConfirm.toLowerCase() === 'yes'
      },
    });

    // Step 4: Send notification
    console.log('\nStep 4: Send Notification');
    const email = await rl.question('Customer email: ');

    await orderWizard.next({
      data: { email },
    });

    // Step 5: Complete order
    console.log('\nStep 5: Complete Order');
    const finalConfirm = await rl.question('Complete order? (yes/no): ');

    await orderWizard.next({
      data: { confirmed: finalConfirm.toLowerCase() === 'yes' },
    });

    console.log('\n=== Wizard Complete ===\n');

    // Show progress using new helpers
    const progress = orderWizard.helpers.progress();
    console.log(`Progress: ${progress.label} (${progress.percent}%)`);

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.log('\nCurrent state:', orderWizard.getCurrent());

    // Show helpful information using new helpers
    const currentStep = orderWizard.getCurrent().step;
    const status = orderWizard.helpers.stepStatus(currentStep);
    const canGoNext = orderWizard.helpers.canGoNext();

    console.log(`Current step status: ${status}`);
    console.log(`Can proceed: ${canGoNext}`);
  } finally {
    rl.close();
  }
}

// Automated saga mode (no user input)
async function runAutomatedSaga() {
  console.log('\n=== Automated Order Saga ===\n');

  try {
    // Show initial state using helpers
    console.log('Available steps:', orderWizard.helpers.availableSteps());
    console.log('Step count:', orderWizard.helpers.stepCount());

    // Initialize
    await orderWizard.next({
      data: {
        orderId: 'ORD-' + Date.now(),
        customerId: 'CUST-123',
        totalAmount: 99.99,
      },
    });

    // Reserve inventory
    await orderWizard.next({
      data: {
        items: [
          { sku: 'WIDGET-001', quantity: 2 },
          { sku: 'GADGET-002', quantity: 1 },
        ],
      },
    });

    // Process payment
    await orderWizard.next({
      data: {
        paymentMethod: 'card',
        confirmed: true,
      },
    });

    // Send notification
    await orderWizard.next({
      data: {
        email: 'customer@example.com',
      },
    });

    // Complete
    await orderWizard.next({
      data: {
        confirmed: true,
      },
    });

    console.log('\n=== Saga Complete ===\n');

    // Show final progress
    const progress = orderWizard.helpers.progress();
    const completedSteps = orderWizard.helpers.completedSteps();
    console.log(`Final progress: ${progress.label} (${progress.percent}%)`);
    console.log('Completed steps:', completedSteps);

  } catch (error) {
    console.error('\n❌ Saga failed:', error);

    // Use helpers to show state
    const current = orderWizard.getCurrent();
    const completedSteps = orderWizard.helpers.completedSteps();
    const remainingSteps = orderWizard.helpers.remainingSteps();

    console.log('Completed steps:', completedSteps);
    console.log('Remaining steps:', remainingSteps);

    // In a real saga, we might implement compensations here
    if (current.ctx.inventoryReserved && !current.ctx.paymentId) {
      console.log('  → Rolling back inventory reservation...');
    }
  }
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'cli';

  if (mode === 'auto') {
    await runAutomatedSaga();
  } else {
    await runCLI();
  }
}

main().catch(console.error);