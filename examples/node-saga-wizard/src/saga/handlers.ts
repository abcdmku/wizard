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
};

export const handleReserveExit = async ({
  data,
  updateContext
}: {
  data: any;
  updateContext: (fn: (ctx: OrderContext) => void) => void
}) => {
  // Simulate async inventory reservation
  await new Promise(resolve => setTimeout(resolve, 1000));

  updateContext((ctx) => {
    ctx.inventoryReserved = true;
  });
};

export const handleChargeExit = async ({
  data,
  context,
  updateContext
}: {
  data: any;
  context: OrderContext;
  updateContext: (fn: (ctx: OrderContext) => void) => void
}) => {
  if (!data.confirmed) {
    throw new Error("Payment not confirmed");
  }

  // Simulate async payment processing
  await new Promise(resolve => setTimeout(resolve, 1500));

  const paymentId = `PAY-${Date.now()}`;
  updateContext((ctx) => {
    ctx.paymentId = paymentId;
  });
};

export const handleNotifyExit = async ({
  data,
  updateContext
}: {
  data: any;
  updateContext: (fn: (ctx: OrderContext) => void) => void
}) => {
  // Simulate async email sending
  await new Promise(resolve => setTimeout(resolve, 800));

  updateContext((ctx) => {
    ctx.emailSent = true;
  });
};

export const handleCompleteExit = ({
  data
}: {
  data: any;
  context: OrderContext
}) => {
  if (!data.confirmed) {
    throw new Error("Order not confirmed");
  }
  // Order completion logic
};