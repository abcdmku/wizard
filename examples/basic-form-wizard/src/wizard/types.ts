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

export type WizardData = {
  account: AccountData;
  personal: PersonalData;
  address: AddressData;
};

export type WizardSteps = keyof WizardData;

export interface WizardContext {
  totalSteps: number;
  completedSteps: string[];
}