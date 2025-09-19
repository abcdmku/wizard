import { createWizard } from "@wizard/core";
import { z } from "zod";

type infoData = { name: string; email: string };

const paymentDataSchema = z.object({
  method: z.string(),
  amount: z.number().positive(),
});

const wizard = createWizard({
  initialStep: "info",
  initialContext: { userId: "123" },
  isOptional: true,
  isRequired: false,
  isStepComplete: false,
  prerequisites: [],
  weights: {},

  steps: {
    info: {
      next: ["payment"],
      load: () => ({ name: "", email: "" } as infoData),
    }, // look in to if theres a better syntax. the goal is to have the wizard infer the types from each step
    payment: {
      next: ["confirm"],
      validate: paymentDataSchema.parse, // refine this syntax but validation should also define data type for a step as well
    },
    confirm: {
      next: [],
    },
  },
});

const payment = wizard.getStepData("payment"); // should return as paymentData type
const info = wizard.getStepData("info"); // should return as infoData type
