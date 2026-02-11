import { createWizardFactory } from "@wizard/core";
import type { OrderContext } from "./types";

const INITIAL_CONTEXT: OrderContext = {
  orderId: "",
  customerId: "",
  inventoryReserved: false,
  paymentId: "",
  emailSent: false,
  totalAmount: 0,
  error: "",
};

const wizardFactory = createWizardFactory<OrderContext>();

export const { defineSteps, step } = wizardFactory;

export const createWizard = <const TDefs extends Record<string, any>>(steps: TDefs) =>
  wizardFactory.createWizard(steps, { context: structuredClone(INITIAL_CONTEXT) });
