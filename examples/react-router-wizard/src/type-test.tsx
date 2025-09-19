import { createWizard } from "@wizard/core";
import { z } from "zod";

// Define Zod schema - this will be used for both validation AND type inference
const paymentDataSchema = z.object({
  method: z.enum(["credit_card", "paypal", "bank_transfer"]),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
});

// Create the wizard
const wizard = createWizard({
  initialStep: "info",
  initialContext: { userId: "123", timestamp: Date.now() },
  steps: {
    info: {
      next: ["payment"],
      // Type is inferred from load function's return type
      load: () => ({
        name: "",
        email: "",
        age: 0
      }),
      required: true,
    },
    payment: {
      next: ["review"],
      // Type is inferred from Zod schema
      validate: paymentDataSchema.parse,
      required: true,
    },
    review: {
      next: ["confirm"],
      // No validator or load = unknown type
      required: true,
    },
    confirm: {
      next: [],
      // Custom completion check
      complete: (data) => data === true,
    },
  },
});

// Now let's test the types
function TypeTest() {
  // These should have proper types inferred!
  const paymentData = wizard.getStepData("payment");
  const infoData = wizard.getStepData("info");
  const reviewData = wizard.getStepData("review");
  const confirmData = wizard.getStepData("confirm");

  // paymentData should have type: { method: "credit_card" | "paypal" | "bank_transfer"; amount: number; currency: string; } | undefined
  if (paymentData) {
    // TypeScript knows the shape!
    console.log(paymentData.method); // ✅ Valid
    console.log(paymentData.amount); // ✅ Valid
    console.log(paymentData.currency); // ✅ Valid
    // console.log(paymentData.invalid); // ❌ Would cause TypeScript error
  }

  // infoData should have type: { name: string; email: string; age: number; } | undefined
  if (infoData) {
    console.log(infoData.name); // ✅ Valid
    console.log(infoData.email); // ✅ Valid
    console.log(infoData.age); // ✅ Valid
  }

  // reviewData is unknown | undefined
  if (reviewData) {
    // Need to narrow the type since it's unknown
    if (typeof reviewData === "object" && reviewData !== null && "notes" in reviewData) {
      console.log(reviewData.notes);
    }
  }

  // Setting data with proper type checking
  wizard.setStepData("info", {
    name: "John Doe",
    email: "john@example.com",
    age: 30
  });

  wizard.setStepData("payment", {
    method: "credit_card",
    amount: 99.99,
    currency: "EUR"
  });

  // Context also has proper types
  const context = wizard.getContext();
  console.log(context.userId); // ✅ Valid
  console.log(context.timestamp); // ✅ Valid

  return (
    <div>
      <h1>Type Inference Demo</h1>
      <pre>{JSON.stringify({ paymentData, infoData }, null, 2)}</pre>
    </div>
  );
}

export default TypeTest;