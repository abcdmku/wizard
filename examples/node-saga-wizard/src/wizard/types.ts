import { z } from "zod";

export interface OrderContext {
  orderId: string;
  customerId: string;
  inventoryReserved: boolean;
  paymentId: string;
  emailSent: boolean;
  totalAmount: number;
  error: string;
}

export const initSchema = z.object({
  orderId: z.string().min(1),
  customerId: z.string().min(1),
  totalAmount: z.number().positive(),
});

export const reserveSchema = z.object({
  items: z.array(
    z.object({
      sku: z.string(),
      quantity: z.number().positive(),
    })
  ).min(1),
});

export const chargeSchema = z.object({
  paymentMethod: z.enum(["card", "paypal"]),
  confirmed: z.boolean(),
});

export const notifySchema = z.object({
  email: z.string().email(),
});

export const completeSchema = z.object({
  confirmed: z.boolean(),
});

export type InitData = z.infer<typeof initSchema>;
export type ReserveData = z.infer<typeof reserveSchema>;
export type ChargeData = z.infer<typeof chargeSchema>;
export type NotifyData = z.infer<typeof notifySchema>;
export type CompleteData = z.infer<typeof completeSchema>;

export type OrderSteps = "init" | "reserve" | "charge" | "notify" | "complete";

export type StepDataMap = {
  init: InitData;
  reserve: ReserveData;
  charge: ChargeData;
  notify: NotifyData;
  complete: CompleteData;
};