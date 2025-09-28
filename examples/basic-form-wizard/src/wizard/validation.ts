import type { AccountData, PersonalData, AddressData } from "./types";

export const validateAccount = ({ data }: { data: unknown }) => {
  const account = data as AccountData;
  if (!account?.email || !account.email.includes("@")) {
    throw new Error("Please enter a valid email");
  }
  if (!account?.password || account.password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  if (account.password !== account.confirmPassword) {
    throw new Error("Passwords do not match");
  }
};

export const validatePersonal = ({ data }: { data: unknown }) => {
  const personal = data as PersonalData;
  if (!personal?.firstName || !personal?.lastName) {
    throw new Error("Please enter your full name");
  }
  if (!personal?.dateOfBirth) {
    throw new Error("Please enter your date of birth");
  }
};

export const validateAddress = ({ data }: { data: unknown }) => {
  const address = data as AddressData;
  if (
    !address?.street ||
    !address?.city ||
    !address?.state ||
    !address?.zipCode ||
    !address?.country
  ) {
    throw new Error("Please fill in all address fields");
  }
};