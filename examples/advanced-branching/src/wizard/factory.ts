import { createReactWizardFactory } from "@wizard/react";
import type { WizardContext } from "./types";

const INITIAL_CONTEXT: WizardContext = {
  role: "user",
  requiresApproval: false,
  completedSteps: [],
};

const wizardFactory = createReactWizardFactory<WizardContext>();

export const { defineSteps, step } = wizardFactory;

export const createWizard = <const TDefs extends Record<string, any>>(steps: TDefs) =>
  wizardFactory.createWizard(steps, { context: structuredClone(INITIAL_CONTEXT) });
