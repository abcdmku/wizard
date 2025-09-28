import { wizardWithContext } from "@wizard/core";
import type { GuardContext } from "./types";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = wizardWithContext<GuardContext>({
  isAuthenticated: false,
  hasUnsavedChanges: false,
  lockedSteps: [],
  completedSteps: []
});