import { wizardWithContext } from "@wizard/core";
import type { WizardContext, UserRole } from "./types";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = wizardWithContext<WizardContext>({
  role: '' as UserRole | '',
  requiresApproval: false,
  completedSteps: []
});