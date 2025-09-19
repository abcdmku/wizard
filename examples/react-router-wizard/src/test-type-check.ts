// @ts-check
import { createWizard } from "@wizard/core";
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
      // The load function return type automatically defines the step's data type
      load: () => ({ name: "", email: "" }),
      required: true,
    },
    payment: {
      next: ["confirm"],
      // The Zod schema defines both validation AND the data type
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
const confirm = wizard.getStepData("confirm");

// These should show proper types in your IDE:
// payment: { method: string; amount: number; } | undefined
// info: { name: string; email: string; } | undefined
// confirm: unknown | undefined

// Type assertions to verify inference is working
type PaymentType = typeof payment;
type InfoType = typeof info;
type ConfirmType = typeof confirm;

// Helper to check types at compile time
type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : false) : false;

// These should all be true if types are correctly inferred
type PaymentCheck = AssertEqual<PaymentType, { method: string; amount: number; } | undefined>;
type InfoCheck = AssertEqual<InfoType, { name: string; email: string; } | undefined>;
type ConfirmCheck = AssertEqual<ConfirmType, unknown | undefined>;

// Uncomment to see the actual types (will show errors but with type info)
// const _paymentType: PaymentCheck = false; // Should be: Type 'false' is not assignable to type 'true'
// const _infoType: InfoCheck = false;       // Should be: Type 'false' is not assignable to type 'true'
// const _confirmType: ConfirmCheck = false; // Should be: Type 'false' is not assignable to type 'true'

console.log("Type inference test complete!");
console.log("Payment data type:", payment);
console.log("Info data type:", info);
console.log("Confirm data type:", confirm);