import { wizardWithContext } from "@wizard/core";
import type { WizardContext } from "./types";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = wizardWithContext<WizardContext>({
  resumeData: {},
  isDirty: false,
  autoSaveEnabled: true,
  recoveredFromStorage: false,
});