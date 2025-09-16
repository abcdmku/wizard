import { z } from 'zod';

// Shared context type across all steps
export type CheckoutContext = {
  userId?: string;
  coupon?: string | null;
  total: number;
};

// Step IDs
export type CheckoutSteps = 'account' | 'shipping' | 'payment' | 'review';

// Validation schemas
export const accountSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const shippingSchema = z.object({
  address: z.string().min(3, 'Address must be at least 3 characters'),
  city: z.string().min(2, 'City is required'),
  zipCode: z.string().min(5, 'Valid zip code required'),
});

export const paymentSchema = z.object({
  cardLast4: z.string().length(4, 'Last 4 digits of card required'),
  cardHolder: z.string().min(2, 'Card holder name required'),
});

export const reviewSchema = z.object({
  agreed: z.boolean().refine((val) => val === true, {
    message: 'You must agree to the terms',
  }),
});

// Step data map
export type CheckoutDataMap = {
  account: z.infer<typeof accountSchema>;
  shipping: z.infer<typeof shippingSchema>;
  payment: z.infer<typeof paymentSchema>;
  review: z.infer<typeof reviewSchema>;
};