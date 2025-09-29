import type { AccountData, PersonalData, AddressData } from "./types";

// Internal validation functions with proper typing
export const validateAccountData = ({data}: {data: AccountData}) => {
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

export const validatePersonalData = ({data}: {data: PersonalData}) => {
  if (!data?.firstName || !data?.lastName) {
    throw new Error("Please enter your full name");
  }
  if (!data?.dateOfBirth) {
    throw new Error("Please enter your date of birth");
  }
};

export const validateAddressData = ({data}: {data: AddressData}) => {
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

