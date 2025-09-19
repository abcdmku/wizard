import { createWizard } from '@wizard/core';
import { createZodValidator } from '@wizard/core/zod';
import type { CheckoutContext, CheckoutSteps, CheckoutDataMap } from './types';
import {
  accountSchema,
  shippingSchema,
  paymentSchema,
  reviewSchema,
} from './types';

export const checkoutWizard = createWizard<
  CheckoutContext,
  CheckoutSteps,
  CheckoutDataMap
>({
  initialStep: 'account',
  initialContext: {
    total: 0,
    coupon: null,
  },
  keepHistory: true,
  maxHistorySize: 10,
  steps: {
    account: {
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
    },
    shipping: {
      validate: createZodValidator(shippingSchema),
      next: ['payment'],
      canEnter: ({ ctx }) => Boolean(ctx.userId),
      load: async ({ setStepData }) => {
        // Simulate loading saved address
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Could pre-populate from saved data
      },
    },
    payment: {
      validate: createZodValidator(paymentSchema),
      next: ({ ctx }) => {
        // Dynamic next step based on context
        return ['review'];
      },
      beforeExit: async ({ updateContext, data }) => {
        // Calculate total after payment info
        await new Promise((resolve) => setTimeout(resolve, 500));
        const subtotal = 100;
        const fee = 2.5;
        updateContext((ctx) => {
          ctx.total = subtotal + fee;
        });
      },
    },
    review: {
      validate: createZodValidator(reviewSchema),
      next: [],
      canEnter: ({ ctx }) => ctx.total > 0,
    },
  },
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