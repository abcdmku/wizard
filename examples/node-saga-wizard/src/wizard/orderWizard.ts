import { defineSteps, step, createWizard } from "./factory";
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

const steps = defineSteps({
  init: step({
    validate: validateInit,
    data: { orderId: "", customerId: "", totalAmount: 0 },
    next: ["reserve"],
    beforeExit: handleInitExit,
    meta: {
      label: "Initialize Order",
      category: "order-management",
      description: "Create a new order with customer and amount details",
    },
  }),
  reserve: step({
    validate: validateReserve,
    data: { items: [] as Array<{ sku: string; quantity: number }> },
    next: ["charge"],
    canEnter: ({ context }) => Boolean(context.orderId),
    beforeExit: handleReserveExit,
    meta: {
      label: "Reserve Inventory",
      category: "inventory-management",
      description: "Reserve inventory for order items",
    },
  }),
  charge: step({
    validate: validateCharge,
    data: { paymentMethod: "card" as "card" | "paypal", confirmed: false },
    next: ["notify"],
    canEnter: ({ context }) => context.inventoryReserved,
    beforeExit: handleChargeExit,
    meta: {
      label: "Process Payment",
      category: "payment-processing",
      description: "Charge customer payment method",
    },
  }),
  notify: step({
    validate: validateNotify,
    data: { email: "" },
    next: ["complete"],
    canEnter: ({ context }) => Boolean(context.paymentId),
    beforeExit: handleNotifyExit,
    meta: {
      label: "Send Notification",
      category: "communication",
      description: "Send order confirmation email to customer",
    },
  }),
  complete: step({
    validate: validateComplete,
    data: { confirmed: false },
    next: [],
    canEnter: ({ context }) => context.emailSent,
    beforeExit: handleCompleteExit,
    meta: {
      label: "Complete Order",
      category: "order-management",
      description: "Finalize the order processing",
    },
  }),
});

export const orderWizard = createWizard(steps, {
  initialStep: "init"
}) as ReturnType<typeof createWizard<typeof steps>>;