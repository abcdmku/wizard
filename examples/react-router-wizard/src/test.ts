import { createWizard } from "@wizard/core";
import { z } from "zod";

// Define schemas for validation and type inference
const paymentDataSchema = z.object({
  method: z.string(),
  amount: z.number().positive(),
});

// Method 1: Use the type inference version (no explicit types needed!)
const wizard = createWizard({
  initialStep: "info",
  initialContext: { userId: "123" },
  steps: {
    info: {
      next: ["payment"],
      // The load function return type automatically defines the step's data type
      load: () => ({ name: "", email: "" }),
      required: true,  // Use new step-level attributes
    },
    payment: {
      next: ["confirm"],
      // The Zod schema defines both validation AND the data type
      validate: paymentDataSchema.parse,
      required: true,
    },
    confirm: {
      next: [],
      // Can add completion logic if needed
      complete: (data) => !!data,
    },
  },
});

// TypeScript now properly infers types!
const payment = wizard.getStepData("payment"); // Correctly typed as { method: string; amount: number; } | undefined
const info = wizard.getStepData("info"); // Correctly typed as { name: string; email: string; } | undefined

// The types are fully inferred from:
// - "info": from the load function's return type
// - "payment": from the Zod schema via paymentDataSchema.parse
// - "confirm": unknown (no validator or load function)

// You can also extract the inferred type if needed:
type PaymentData = z.infer<typeof paymentDataSchema>;
