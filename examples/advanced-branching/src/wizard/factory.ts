import type { WizardContext } from "./types";
import type { StepName } from "./stepNames";
import { reactWizardWithContext } from "@wizard/react";

// Create factory with context type
const wizardFactory = reactWizardWithContext<WizardContext>({
  role: 'user',
  requiresApproval: false,
  completedSteps: []
});

// Create a typed builder
const { step, build } = wizardFactory.builder<StepName>();

// Export for use in config
export { step, wizardFactory };
export const defineSteps = build;
export const createWizard = wizardFactory.createWizard;