import { reactWizardWithContext } from "@wizard/react";
import type { CheckoutContext } from "../types";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = reactWizardWithContext<CheckoutContext>({
  total: 0,
  coupon: null
});