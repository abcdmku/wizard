#!/usr/bin/env node
/**
 * Node.js CLI wizard example - demonstrates usage without React
 * Simulates an order processing saga with multiple steps
 */

import { createWizard } from '@wizard/core';
import { createZodValidator } from '@wizard/core/zod';
import { z } from 'zod';
import readline from 'readline/promises';

// Types
type OrderContext = {
  orderId: string;
  customerId?: string;
  inventoryReserved: boolean;
  paymentId?: string;
  emailSent: boolean;
  totalAmount: number;
  error?: string;
};

type OrderSteps = 'init' | 'reserve' | 'charge' | 'notify' | 'complete';

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

type OrderDataMap = {
  init: z.infer<typeof initSchema>;
  reserve: z.infer<typeof reserveSchema>;
  charge: z.infer<typeof chargeSchema>;
  notify: z.infer<typeof notifySchema>;
  complete: z.infer<typeof completeSchema>;
};

// Create the wizard
const orderWizard = createWizard<OrderContext, OrderSteps, OrderDataMap>({
  initialStep: 'init',
  initialContext: {
    orderId: '',
    inventoryReserved: false,
    emailSent: false,
    totalAmount: 0,
  },
  steps: {
    init: {
      validate: createZodValidator(initSchema),
      next: ['reserve'],
      beforeExit: ({ data, updateContext }) => {
        updateContext((ctx) => {
          ctx.orderId = data.orderId;
          ctx.customerId = data.customerId;
          ctx.totalAmount = data.totalAmount;
        });
        console.log('✓ Order initialized:', data.orderId);
      },
    },
    reserve: {
      validate: createZodValidator(reserveSchema),
      next: ['charge'],
      canEnter: ({ ctx }) => Boolean(ctx.orderId),
      beforeExit: async ({ data, updateContext }) => {
        // Simulate inventory reservation
        console.log('  Reserving inventory for items:', data.items);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        updateContext((ctx) => {
          ctx.inventoryReserved = true;
        });
        console.log('✓ Inventory reserved');
      },
    },
    charge: {
      validate: createZodValidator(chargeSchema),
      next: ['notify'],
      canEnter: ({ ctx }) => ctx.inventoryReserved,
      beforeExit: async ({ data, ctx, updateContext }) => {
        if (!data.confirmed) {
          throw new Error('Payment not confirmed');
        }
        
        // Simulate payment processing
        console.log(`  Processing ${data.paymentMethod} payment for $${ctx.totalAmount}`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const paymentId = `PAY-${Date.now()}`;
        updateContext((ctx) => {
          ctx.paymentId = paymentId;
        });
        console.log('✓ Payment processed:', paymentId);
      },
    },
    notify: {
      validate: createZodValidator(notifySchema),
      next: ['complete'],
      canEnter: ({ ctx }) => Boolean(ctx.paymentId),
      beforeExit: async ({ data, updateContext }) => {
        // Simulate sending email
        console.log(`  Sending order confirmation to ${data.email}`);
        await new Promise(resolve => setTimeout(resolve, 800));
        
        updateContext((ctx) => {
          ctx.emailSent = true;
        });
        console.log('✓ Notification sent');
      },
    },
    complete: {
      validate: createZodValidator(completeSchema),
      next: [],
      canEnter: ({ ctx }) => ctx.emailSent,
      beforeExit: ({ data, ctx }) => {
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
    },
  },
  onTransition: (event) => {
    console.log(`\n→ Moving from ${event.from} to ${event.to}`);
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

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.log('\nCurrent state:', orderWizard.getCurrent());
  } finally {
    rl.close();
  }
}

// Automated saga mode (no user input)
async function runAutomatedSaga() {
  console.log('\n=== Automated Order Saga ===\n');
  
  try {
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
    
  } catch (error) {
    console.error('\n❌ Saga failed:', error);
    
    // In a real saga, we might implement compensations here
    const state = orderWizard.getCurrent();
    if (state.ctx.inventoryReserved && !state.ctx.paymentId) {
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