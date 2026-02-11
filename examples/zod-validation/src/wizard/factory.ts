import { createWizardFactory } from "@wizard/core";
import type { ValidationContext } from "./types";

const INITIAL_CONTEXT: ValidationContext = {
  validationErrors: {},
  isValidating: false,
  completedSteps: [],
  attemptedSteps: []
};

const wizardFactory = createWizardFactory<ValidationContext>();

export const { defineSteps, step } = wizardFactory;

export const createWizard = <const TDefs extends Record<string, any>>(steps: TDefs) =>
  wizardFactory.createWizard(steps, { context: structuredClone(INITIAL_CONTEXT) });
