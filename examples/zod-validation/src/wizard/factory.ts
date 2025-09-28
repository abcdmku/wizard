import { wizardWithContext } from "@wizard/core";
import type { ValidationContext } from "./types";

// Create factory with validation context
export const { defineSteps, step, createWizard } = wizardWithContext<ValidationContext>({
  validationErrors: {},
  isValidating: false,
  completedSteps: [],
  attemptedSteps: []
});