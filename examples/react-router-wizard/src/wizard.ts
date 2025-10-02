import { defineSteps, step, createWizard } from './wizard/factory';
import { useWizard, useWizardStep } from "@wizard/react";
import { accountSchema, shippingSchema, paymentSchema, reviewSchema } from './types';

const steps = defineSteps({
  account: step({
    data: { email: '' },
    validate: ({ data }) => accountSchema.parse(data),
    next: ['shipping'],
    beforeExit: async ({ updateContext, data }) => { 
      updateContext(ctx => { ctx.userId = data.email.toLowerCase(); }); 
      await new Promise(r => setTimeout(r, 500)); 
    },
  }),
  shipping: step({
    data: { address: '', city: '', zipCode: '' },
    validate: ({ data }) => shippingSchema.parse(data),
    next: ['payment'],
    beforeEnter: async () => await new Promise(r => setTimeout(r, 1000)),
  }),
  payment: step({
    data: { cardLast4: '', cardHolder: '' },
    validate: ({ data }) => paymentSchema.parse(data),
    next: ['review'],
    beforeExit: async ({ updateContext }) => {
      await new Promise(r => setTimeout(r, 500));
      updateContext(ctx => { ctx.total = 102.5; });
    },
  }),
  review: step({
    data: { agreed: false },
    validate: ({ data }) => reviewSchema.parse(data),
    next: [],
  }),
});

export const checkoutWizard = createWizard(steps) as ReturnType<typeof createWizard<typeof steps>>;
export const useCheckoutWizard = () => useWizard(checkoutWizard);
export const useAccountStep = () => useWizardStep(checkoutWizard, "account");
export const useShippingStep = () => useWizardStep(checkoutWizard, "shipping");
export const usePaymentStep = () => useWizardStep(checkoutWizard, "payment");
export const useReviewStep = () => useWizardStep(checkoutWizard, "review");