import { createWizardFactory } from "@wizard/core";

export interface AccountData {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface PersonalData {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export interface AddressData {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}


export const validateAccountData = ({data}: {data: AccountData}) => {
  if (!data?.email || !data.email.includes("@")) throw new Error("Please enter a valid email");
  if (data.password !== data.confirmPassword) throw new Error("Passwords do not match");
};

export const validatePersonalData = ({data}: {data: PersonalData}) => {
  if (!data?.firstName || !data?.lastName) throw new Error("Please enter your full name");
  if (!data?.dateOfBirth) throw new Error("Please enter your date of birth");
};

export const validateAddressData = ({data}: {data: AddressData}) => {
  if ( !data?.street || !data?.city || !data?.state || !data?.zipCode || !data?.country )
    throw new Error("Please fill in all address fields");
};

const { defineSteps, step, createWizard } = createWizardFactory();

export const steps = defineSteps({
  account: step({
    data: {} as AccountData,
    next: ["personal"],
    meta: { label: "Account", iconKey: "user" },
    validate: validateAccountData,
  }),
  personal: step({
    validate: validatePersonalData,
    data: {} as PersonalData,
    next: ["address"],
    meta: { label: "Personal", iconKey: "person" },
  }),
  address: step({
    validate: validateAddressData,
    data: {} as AddressData,
    next: [],
    meta: { label: "Address", iconKey: "location" },
  }),
});

export const FormWizard = createWizard(steps);

