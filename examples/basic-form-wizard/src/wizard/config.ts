import { defineSteps, step, createWizard } from "./factory";
import { validateAccount, validatePersonal, validateAddress } from "./validation";
import type { WizardData } from "./types";

const initialData: WizardData = {
  account: { email: "", password: "", confirmPassword: "" },
  personal: { firstName: "", lastName: "", dateOfBirth: "" },
  address: { street: "", city: "", state: "", zipCode: "", country: "" }
};

export const steps = defineSteps({
  account: step({
    validate: validateAccount,
    data: initialData.account,
    next: ["personal"],
    meta: { label: "Account", iconKey: "user" },
  }),
  personal: step({
    validate: validatePersonal,
    data: initialData.personal,
    next: ["address"],
    meta: { label: "Personal", iconKey: "person" },
  }),
  address: step({
    validate: validateAddress,
    data: initialData.address,
    next: [],
    meta: { label: "Address", iconKey: "location" },
  }),
});

export const formWizard = createWizard(steps);