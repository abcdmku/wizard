import { createWizardFactory } from "@wizard/core";
import { useWizard, useWizardStep } from "@wizard/react";

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
  account: step<AccountData>({
    data: {} as AccountData,
    next: ["personal"],
    meta: { label: "Account", iconKey: "user" },
    validate: validateAccountData,
  }),
  personal: step<PersonalData>({
    validate: validatePersonalData,
    data: {} as PersonalData,
    next: ["address"],
    meta: { label: "Personal", iconKey: "person" },
  }),
  address: step<AddressData>({
    validate: validateAddressData,
    data: {} as AddressData,
    next: ["summary"],
    meta: { label: "Address", iconKey: "location" },
  }),
  summary: step<{}>({
    data: {} as {},
    next: [],
    meta: { label: "Complete", iconKey: "check", hidden: true },
  }),
});

export const FormWizard = createWizard(steps) as ReturnType<typeof createWizard<typeof steps>>;

/**
 * Typed convenience hook for using FormWizard.
 * This eliminates the need to pass FormWizard to useWizard in every component.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { step, data, next } = useFormWizard();
 * }
 * ```
 */
export const useFormWizard = () => useWizard(FormWizard);

/**
 * Step-specific typed convenience hooks.
 * These provide direct access to individual steps with full type safety.
 */
export const useAccountStep = () => useWizardStep(FormWizard, "account");
export const usePersonalStep = () => useWizardStep(FormWizard, "personal");
export const useAddressStep = () => useWizardStep(FormWizard, "address");
