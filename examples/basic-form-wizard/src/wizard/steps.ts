import { validateAccountData, validatePersonalData, validateAddressData } from "./validation";
import type { WizardData } from "./types";
import { wizardWithContext } from "@wizard/core";

const initialData: WizardData = {
  account: { email: "", password: "", confirmPassword: "" },
  personal: { firstName: "", lastName: "", dateOfBirth: "" },
  address: { street: "", city: "", state: "", zipCode: "", country: "" }
};

const { defineSteps, step, createWizard } = wizardWithContext({
  totalSteps: 3,
  completedSteps: [],
  context: initialData
});


export const steps = defineSteps({
  account: step({
    data: initialData.account,
    next: ["personal"],
    meta: { label: "Account", iconKey: "user" },
    validate: validateAccountData,
  }),
  personal: step({
    validate: validatePersonalData,
    data: initialData.personal,
    next: ["address"],
    meta: { label: "Personal", iconKey: "person" },
  }),
  address: step({
    validate: validateAddressData,
    data: initialData.address,
    next: [],
    meta: { label: "Address", iconKey: "location" },
  }),
});

export const formWizard = createWizard(steps);
