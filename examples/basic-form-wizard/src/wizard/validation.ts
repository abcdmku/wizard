import type { AccountData, PersonalData, AddressData } from "./types";
import type { ValidateArgs } from "@wizard/core";
import type { WizardContext } from "./types";

// Internal validation functions with proper typing
const validateAccountData = (data: AccountData) => {
  if (!data?.email || !data.email.includes("@")) {
    throw new Error("Please enter a valid email");
  }
  if (!data?.password || data.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (data.password !== data.confirmPassword) {
    throw new Error("Passwords do not match");
  }
};

const validatePersonalData = (data: PersonalData) => {
  if (!data?.firstName || !data?.lastName) {
    throw new Error("Please enter your full name");
  }
  if (!data?.dateOfBirth) {
    throw new Error("Please enter your date of birth");
  }
};

const validateAddressData = (data: AddressData) => {
  if (
    !data?.street ||
    !data?.city ||
    !data?.state ||
    !data?.zipCode ||
    !data?.country
  ) {
    throw new Error("Please fill in all address fields");
  }
};

// Exported validation functions that match the wizard framework signature
export const validateAccount = ({ data }: ValidateArgs<WizardContext>) => {
  validateAccountData(data as AccountData);
};

export const validatePersonal = ({ data }: ValidateArgs<WizardContext>) => {
  validatePersonalData(data as PersonalData);
};

export const validateAddress = ({ data }: ValidateArgs<WizardContext>) => {
  validateAddressData(data as AddressData);
};