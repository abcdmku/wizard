import { createWizardFactory } from "@wizard/core";
import type { GuardContext } from "./types";

const INITIAL_CONTEXT: GuardContext = {
  isAuthenticated: false,
  hasUnsavedChanges: false,
  lockedSteps: [],
  completedSteps: []
};

const wizardFactory = createWizardFactory<GuardContext>();

export const { defineSteps, step } = wizardFactory;

export const createWizard = <const TDefs extends Record<string, any>>(steps: TDefs) =>
  wizardFactory.createWizard(steps, { context: structuredClone(INITIAL_CONTEXT) });
