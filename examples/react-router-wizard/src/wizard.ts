import { defineSteps, step, createWizard } from './wizard/factory';
import { createZodValidator } from '@wizard/core/zod';
import {
  accountSchema,
  shippingSchema,
  paymentSchema,
  reviewSchema,
} from './types';

const steps = defineSteps({
  account: step({
    data: { email: '' },
    validate: createZodValidator(accountSchema),
    next: ['shipping'],
    beforeExit: async ({ updateContext, data }) => {
      // Set userId based on email (simulated)
      updateContext((ctx) => {
        ctx.userId = data.email.toLowerCase();
      });
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  }),
  shipping: step({
    data: { address: '', city: '', zipCode: '' },
    validate: createZodValidator(shippingSchema),
    next: ['payment'],
    canEnter: ({ context }) => Boolean(context.userId),
    beforeEnter: async () => {
      // Simulate loading saved address
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Could pre-populate from saved data
    },
  }),
  payment: step({
    data: { cardLast4: '', cardHolder: '' },
    validate: createZodValidator(paymentSchema),
    next: ({ context }) => {
      // Dynamic next step based on context
      return ['review'];
    },
    canEnter: ({ context }) => Boolean(context.userId),
    beforeExit: async ({ updateContext, data }) => {
      // Calculate total after payment info
      await new Promise((resolve) => setTimeout(resolve, 500));
      const subtotal = 100;
      const fee = 2.5;
      updateContext((ctx) => {
        ctx.total = subtotal + fee;
      });
    },
  }),
  review: step({
    data: { agreed: false },
    validate: createZodValidator(reviewSchema),
    next: [],
    canEnter: ({ context }) => context.total > 0,
  }),
});

export const checkoutWizard = createWizard(steps, {
  initialStep: 'account',
  keepHistory: true,
  maxHistorySize: 10,
  onTransition: (event) => {
    console.log('Wizard transition:', event);
  },
  persistence: {
    save: (state) => {
      localStorage.setItem('checkout-wizard', JSON.stringify(state));
    },
    load: () => {
      const saved = localStorage.getItem('checkout-wizard');
      return saved ? JSON.parse(saved) : null;
    },
    clear: () => {
      localStorage.removeItem('checkout-wizard');
    },
  },
});