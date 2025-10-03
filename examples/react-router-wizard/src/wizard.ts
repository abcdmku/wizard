import { defineSteps, step, createWizard } from './wizard/factory';
import { accountSchema, shippingSchema, paymentSchema, reviewSchema } from './types';
import { AccountStep } from './components/AccountStep';
import { ShippingStep } from './components/ShippingStep';
import { PaymentStep } from './components/PaymentStep';
import { ReviewStep } from './components/ReviewStep';

const steps = defineSteps({
  account: step({
    data: { email: '' },
    component: AccountStep,
    validate: ({ data }) => accountSchema.parse(data),
    next: ['shipping'],
    beforeExit: ({ updateContext, data }) => {
      updateContext(ctx => { ctx.userId = data.email.toLowerCase(); });
    },
  }),
  shipping: step({
    data: { address: '', city: '', zipCode: '' },
    component: ShippingStep,
    validate: ({ data }) => shippingSchema.parse(data),
    next: ['payment']
  }),
  payment: step({
    data: { cardLast4: '', cardHolder: '' },
    component: PaymentStep,
    validate: ({ data }) => paymentSchema.parse(data),
    next: ['review'],
    beforeExit: ({ updateContext }) => {
      updateContext(ctx => { ctx.total = 102.5; });
    },
  }),
  review: step({
    data: { agreed: false },
    component: ReviewStep,
    validate: ({ data }) => reviewSchema.parse(data),
    next: [],
  }),
});

export const checkoutWizard = createWizard(steps)