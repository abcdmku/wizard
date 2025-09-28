import { wizardWithContext } from "@wizard/core";
import type { CheckoutContext } from "../types";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = wizardWithContext<CheckoutContext>({
  total: 0,
  coupon: null
});