import type { OrderContext } from "../wizard/types";

export const handleInitExit = ({ 
  data, 
  updateContext 
}: { 
  data: any; 
  updateContext: (fn: (ctx: OrderContext) => void) => void 
}) => {
  updateContext((ctx) => {
    ctx.orderId = data.orderId;
    ctx.customerId = data.customerId;
    ctx.totalAmount = data.totalAmount;
  });
  console.log("✓ Order initialized:", data.orderId);
};

export const handleReserveExit = async ({ 
  data, 
  updateContext 
}: { 
  data: any; 
  updateContext: (fn: (ctx: OrderContext) => void) => void 
}) => {
  console.log("  Reserving inventory for items:", data.items);
  await new Promise(resolve => setTimeout(resolve, 1000));

  updateContext((ctx) => {
    ctx.inventoryReserved = true;
  });
  console.log("✓ Inventory reserved");
};

export const handleChargeExit = async ({ 
  data, 
  ctx, 
  updateContext 
}: { 
  data: any; 
  ctx: OrderContext; 
  updateContext: (fn: (ctx: OrderContext) => void) => void 
}) => {
  if (!data.confirmed) {
    throw new Error("Payment not confirmed");
  }

  console.log(`  Processing ${data.paymentMethod} payment for $${ctx.totalAmount}`);
  await new Promise(resolve => setTimeout(resolve, 1500));

  const paymentId = `PAY-${Date.now()}`;
  updateContext((ctx) => {
    ctx.paymentId = paymentId;
  });
  console.log("✓ Payment processed:", paymentId);
};

export const handleNotifyExit = async ({ 
  data, 
  updateContext 
}: { 
  data: any; 
  updateContext: (fn: (ctx: OrderContext) => void) => void 
}) => {
  console.log(`  Sending order confirmation to ${data.email}`);
  await new Promise(resolve => setTimeout(resolve, 800));

  updateContext((ctx) => {
    ctx.emailSent = true;
  });
  console.log("✓ Notification sent");
};

export const handleCompleteExit = ({ 
  data, 
  ctx 
}: { 
  data: any; 
  ctx: OrderContext 
}) => {
  if (!data.confirmed) {
    throw new Error("Order not confirmed");
  }
  console.log("✓ Order completed successfully!");
  console.log("  Final state:", {
    orderId: ctx.orderId,
    customerId: ctx.customerId,
    paymentId: ctx.paymentId,
    totalAmount: ctx.totalAmount,
  });
};