import { createReactWizardFactory } from "@wizard/react";
import { DoneStep } from "../components/steps/DoneStep";
import { InfoStep } from "../components/steps/InfoStep";
import { PaymentStep } from "../components/steps/PaymentStep";
import { PlanStep } from "../components/steps/PlanStep";

export interface InfoData {
  name: string;
}

export interface PlanData {
  tier: "" | "free" | "pro" | "team";
}

export interface PaymentData {
  card: string;
}

export const validateInfoData = ({ data }: { data: InfoData }) => {
  if (!data?.name.trim()) {
    throw new Error("Please enter your name");
  }
};

export const validatePlanData = ({ data }: { data: PlanData }) => {
  if (!data?.tier) {
    throw new Error("Please choose a plan");
  }
};

export const validatePaymentData = ({ data }: { data: PaymentData }) => {
  const digits = data?.card.replace(/\D/g, "") ?? "";
  if (digits.length < 12) {
    throw new Error("Please enter a valid card number");
  }
};

const { defineSteps, step, createWizard } = createReactWizardFactory();

export const steps = defineSteps({
  info: step({
    data: { name: "" },
    next: ["plan"],
    meta: { label: "Info", iconKey: "user" },
    validate: validateInfoData,
    component: InfoStep,
  }),
  plan: step({
    data: { tier: "" },
    next: ["pay"],
    meta: { label: "Plan", iconKey: "plan" },
    validate: validatePlanData,
    component: PlanStep,
  }),
  pay: step({
    data: { card: "" },
    next: ["done"],
    meta: { label: "Payment", iconKey: "payment" },
    validate: validatePaymentData,
    component: PaymentStep,
  }),
  done: step({
    data: { ok: false },
    next: [],
    meta: { label: "Done", iconKey: "check", hidden: true },
    component: DoneStep,
  }),
});

export const FormWizard = createWizard(steps);
