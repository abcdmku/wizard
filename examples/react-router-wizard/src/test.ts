import { createWizard, defineSteps } from "@wizard/core";
import { z } from "zod";

// Define schemas for validation and type inference
const paymentDataSchema = z.object({
  method: z.string(),
  amount: z.number().positive(),
});

const infoDataSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

// Validation functions
const validatePayment = ({ data }: { data: unknown }) => {
  paymentDataSchema.parse(data);
};

const validateInfo = ({ data }: { data: unknown }) => {
  infoDataSchema.parse(data);
};

// Method 1: Use the type inference version (no explicit types needed!)
const steps = defineSteps({
  info: {
    validate: validateInfo,
    data: { name: '', email: '' },
    next: ["payment"],
    required: true,
  },
  payment: {
    validate: validatePayment,
    data: { method: '', amount: 0 },
    next: ["confirm"],
    required: true,
  },
  confirm: {
    data: { confirmed: false },
    next: [],
    complete: ({ data }) => !!data?.confirmed,
  },
});

const wizard = createWizard({
  context: { userId: "123" },
  steps,
});

// TypeScript now properly infers types!
const payment = wizard.getStepData("payment"); // Correctly typed as { method: string; amount: number; } | undefined
const info = wizard.getStepData("info"); // Correctly typed as { name: string; email: string; } | undefined

// The types are fully inferred from:
// - "info": from the validate function and data initializer
// - "payment": from the validate function and data initializer
// - "confirm": from the data initializer

// You can also extract the inferred type if needed:
type PaymentData = z.infer<typeof paymentDataSchema>;
type InfoData = z.infer<typeof infoDataSchema>;

void (payment satisfies { method: string; amount: number } | undefined);
void (info satisfies { name: string; email: string } | undefined);
