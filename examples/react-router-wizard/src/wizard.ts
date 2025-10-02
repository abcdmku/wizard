import { defineSteps, step, createWizard } from './wizard/factory';
import { useWizard, useWizardStep } from "@wizard/react";
import {
  accountSchema,
  shippingSchema,
  paymentSchema,
  reviewSchema,
} from './types';

const steps = defineSteps({
  account: step({
    data: { email: '' },
    validate: ({ data }) => {
      accountSchema.parse(data);
    },
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
    validate: ({ data }) => {
      shippingSchema.parse(data);
    },
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
    validate: ({ data }) => {
      paymentSchema.parse(data);
    },
    next: ['review'],
    canEnter: ({ context }) => Boolean(context.userId),
    beforeExit: async ({ updateContext }) => {
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
    validate: ({ data }) => {
      reviewSchema.parse(data);
    },
    next: [],
    canEnter: ({ context }) => context.total > 0,
  }),
});

export const checkoutWizard = createWizard(steps) as ReturnType<typeof createWizard<typeof steps>>;

/**
 * Typed convenience hook for using checkoutWizard.
 */
export const useCheckoutWizard = () => useWizard(checkoutWizard);

/**
 * Step-specific typed convenience hooks.
 */
export const useAccountStep = () => useWizardStep(checkoutWizard, "account");
export const useShippingStep = () => useWizardStep(checkoutWizard, "shipping");
export const usePaymentStep = () => useWizardStep(checkoutWizard, "payment");
export const useReviewStep = () => useWizardStep(checkoutWizard, "review");