import type { WizardContext } from "./types";
import type { StepName } from "./stepNames";
import { reactWizardWithContext } from "@wizard/react";

// Create factory with context type
const wizardFactory = reactWizardWithContext<WizardContext>({
  role: 'user',
  requiresApproval: false,
  completedSteps: []
});

// Create typed step builder - step names are explicitly defined in stepNames.ts
const { step, registerSteps } = wizardFactory.defineSteps<StepName>();

// Export for use in config
export { step, registerSteps };
export const createWizard = wizardFactory.createWizard;