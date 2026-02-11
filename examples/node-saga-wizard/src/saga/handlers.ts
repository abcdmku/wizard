import type {
  ChargeData,
  CompleteData,
  InitData,
  NotifyData,
  OrderContext,
  ReserveData,
} from "../wizard/types";

export const handleInitExit = ({
  data,
  updateContext
}: {
  data: InitData;
  updateContext: (fn: (ctx: OrderContext) => void) => void
}) => {
  updateContext((ctx) => {
    ctx.orderId = data.orderId;
    ctx.customerId = data.customerId;
    ctx.totalAmount = data.totalAmount;
  });
};

export const handleReserveExit = async ({
  data: _data,
  updateContext
}: {
  data: ReserveData;
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
  updateContext
}: {
  data: ChargeData;
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
  data: _data,
  updateContext
}: {
  data: NotifyData;
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
  data: CompleteData;
}) => {
  if (!data.confirmed) {
    throw new Error("Order not confirmed");
  }
  // Order completion logic
};
