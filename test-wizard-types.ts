import { createWizard } from "./packages/core/src";
import { z } from "zod";

// Define schemas for validation and type inference
const paymentDataSchema = z.object({
  method: z.string(),
  amount: z.number().positive(),
});

// Create wizard with type inference
const wizard = createWizard({
  initialStep: "info",
  initialContext: { userId: "123" },
  steps: {
    info: {
      next: ["payment"],
      load: () => ({ name: "", email: "" }),
      required: true,
    },
    payment: {
      next: ["confirm"],
      validate: paymentDataSchema.parse,
      required: true,
    },
    confirm: {
      next: [],
      complete: (data) => !!data,
    },
  },
});

// Test type inference
const payment = wizard.getStepData("payment");
const info = wizard.getStepData("info");

// Helper type to extract the actual type
type ExtractType<T> = T extends (...args: any[]) => any ? never : T;

// Check what types we're getting
type PaymentActual = ExtractType<typeof payment>;
type InfoActual = ExtractType<typeof info>;

// Export to see types in IDE
export { payment, info };
export type { PaymentActual, InfoActual };