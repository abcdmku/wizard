import { wizardWithContext } from "@wizard/core";
import type { OrderContext } from "./types";

// Create factory with context type and destructure methods for cleaner usage
export const { defineSteps, step, createWizard } = wizardWithContext<OrderContext>({
  orderId: "",
  customerId: "",
  inventoryReserved: false,
  paymentId: "",
  emailSent: false,
  totalAmount: 0,
  error: "",
});