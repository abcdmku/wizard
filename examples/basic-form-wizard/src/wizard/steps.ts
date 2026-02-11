import { createReactWizardFactory } from "@wizard/react";
import { AccountStep } from "../components/steps/AccountStep";
import { PersonalStep } from "../components/steps/PersonalStep";
import { AddressStep } from "../components/steps/AddressStep";
import { SummaryStep } from "../components/steps/SummaryStep";

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

const { defineSteps, step, createWizard } = createReactWizardFactory();

export const steps = defineSteps({
  account: step({
    data: {
      email: "",
      password: "",
      confirmPassword: "",
    },
    next: ["personal"],
    meta: { label: "Account", iconKey: "user" },
    validate: validateAccountData,
    component: AccountStep
  }),
  personal: step({
    validate: validatePersonalData,
    data: {
      firstName: "",
      lastName: "",
      dateOfBirth: "",
    },
    next: ["address"],
    meta: { label: "Personal", iconKey: "person" },
    component: PersonalStep
  }),
  address: step({
    validate: validateAddressData,
    data: {
      street: "",
      city: "",
      state: "",
      zipCode: "",
      country: "",
    },
    next: ["summary"],
    meta: { label: "Address", iconKey: "location" },
    component: AddressStep
  }),
  summary: step({
    data: {},
    next: [],
    meta: { label: "Complete", iconKey: "check", hidden: true },
    component: SummaryStep,
  }),
});

export const FormWizard = createWizard(steps);
