import type { WizardContext } from "./types";
import { reactWizardWithContext } from "@wizard/react";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = reactWizardWithContext<WizardContext>({
  role: 'user',
  requiresApproval: false,
  completedSteps: []
});