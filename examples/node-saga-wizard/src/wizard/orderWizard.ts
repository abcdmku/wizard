import { createWizard, defineSteps } from "@wizard/core";
import {
  validateInit,
  validateReserve,
  validateCharge,
  validateNotify,
  validateComplete,
} from "./validation";
import {
  handleInitExit,
  handleReserveExit,
  handleChargeExit,
  handleNotifyExit,
  handleCompleteExit,
} from "../saga/handlers";
import type { OrderContext } from "./types";

const steps = defineSteps({
  init: {
    validate: validateInit,
    data: { orderId: "", customerId: "", totalAmount: 0 },
    next: ["reserve"],
    beforeExit: handleInitExit,
    meta: {
      label: "Initialize Order",
      category: "order-management",
      description: "Create a new order with customer and amount details",
    },
  },
  reserve: {
    validate: validateReserve,
    data: { items: [] as Array<{ sku: string; quantity: number }> },
    next: ["charge"],
    canEnter: ({ ctx }: { ctx: OrderContext }) => Boolean(ctx.orderId),
    beforeExit: handleReserveExit,
    meta: {
      label: "Reserve Inventory",
      category: "inventory-management",
      description: "Reserve inventory for order items",
    },
  },
  charge: {
    validate: validateCharge,
    data: { paymentMethod: "card" as "card" | "paypal", confirmed: false },
    next: ["notify"],
    canEnter: ({ ctx }: { ctx: OrderContext }) => ctx.inventoryReserved,
    beforeExit: handleChargeExit,
    meta: {
      label: "Process Payment",
      category: "payment-processing",
      description: "Charge customer payment method",
    },
  },
  notify: {
    validate: validateNotify,
    data: { email: "" },
    next: ["complete"],
    canEnter: ({ ctx }: { ctx: OrderContext }) => Boolean(ctx.paymentId),
    beforeExit: handleNotifyExit,
    meta: {
      label: "Send Notification",
      category: "communication",
      description: "Send order confirmation email to customer",
    },
  },
  complete: {
    validate: validateComplete,
    data: { confirmed: false },
    next: [],
    canEnter: ({ ctx }: { ctx: OrderContext }) => ctx.emailSent,
    beforeExit: handleCompleteExit,
    meta: {
      label: "Complete Order",
      category: "order-management",
      description: "Finalize the order processing",
    },
  },
});

export const orderWizard = createWizard({
  context: {
    orderId: "",
    customerId: "",
    inventoryReserved: false,
    paymentId: "",
    emailSent: false,
    totalAmount: 0,
    error: "",
  } as OrderContext,
  steps,
  onStatusChange: ({ step, next }) => {
    console.log(`\n→ Step ${step} status: ${next}`);
  },
});