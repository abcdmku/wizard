import { createWizard, defineSteps } from "@wizard/core";
import { validateAccount, validatePersonal, validateAddress } from "./validation";
import type { WizardData } from "./types";

const initialData: WizardData = {
  account: { email: "", password: "", confirmPassword: "" },
  personal: { firstName: "", lastName: "", dateOfBirth: "" },
  address: { street: "", city: "", state: "", zipCode: "", country: "" }
};

export const steps = defineSteps({
  account: {
    validate: validateAccount,
    data: initialData.account,
    next: ["personal"],
    meta: { label: "Account", iconKey: "user" },
  },
  personal: {
    validate: validatePersonal,
    data: initialData.personal,
    next: ["address"],
    meta: { label: "Personal", iconKey: "person" },
  },
  address: {
    validate: validateAddress,
    data: initialData.address,
    next: [],
    meta: { label: "Address", iconKey: "location" },
  },
});

export const formWizard = createWizard({
  context: { totalSteps: 3, completedSteps: [] as string[] },
  steps,
});