import { z } from 'zod';

// Zod schemas for each step's data
export const PersonalInfoSchema = z.object({
  firstName: z.string().min(2, "First name must be at least 2 characters"),
  lastName: z.string().min(2, "Last name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  age: z.number().min(18, "Must be at least 18 years old").max(120, "Invalid age")
});

export const AddressSchema = z.object({
  street: z.string().min(5, "Street address is required"),
  city: z.string().min(2, "City is required"),
  state: z.string().length(2, "State must be 2 characters"),
  zipCode: z.string().regex(/^\d{5}(-\d{4})?$/, "Invalid ZIP code format")
});

export const PreferencesSchema = z.object({
  newsletter: z.boolean(),
  notifications: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean()
  }),
  theme: z.enum(['light', 'dark', 'auto']),
  language: z.enum(['en', 'es', 'fr', 'de'])
});

export const ReviewSchema = z.object({
  agreeToTerms: z.boolean().refine(val => val === true, {
    message: "You must agree to the terms and conditions"
  }),
  dataProcessing: z.boolean().refine(val => val === true, {
    message: "You must consent to data processing"
  })
});

// TypeScript types inferred from schemas
export type PersonalInfo = z.infer<typeof PersonalInfoSchema>;
export type Address = z.infer<typeof AddressSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Review = z.infer<typeof ReviewSchema>;

// Wizard context type
export interface ValidationContext {
  validationErrors: Record<string, string[]>;
  isValidating: boolean;
  completedSteps: string[];
  attemptedSteps: string[];
}

// Combined wizard data type
export interface WizardData {
  personalInfo: PersonalInfo;
  address: Address;
  preferences: Preferences;
  review: Review;
}