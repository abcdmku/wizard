import { wizardWithContext, stepWithValidation } from "@wizard/core";
import type { WizardContext } from "./types";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = wizardWithContext<WizardContext>({
  totalSteps: 3,
  completedSteps: []
});

// Export stepWithValidation for properly typed validation
export { stepWithValidation };