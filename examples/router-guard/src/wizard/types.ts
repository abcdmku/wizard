export interface GuardContext {
  isAuthenticated: boolean;
  hasUnsavedChanges: boolean;
  lockedSteps: string[];
  completedSteps: string[];
  userId?: string;
}

export interface IntroductionData {
  agreed: boolean;
}

export interface AuthenticationData {
  username: string;
  password: string;
  verified: boolean;
}

export interface SecureData {
  secretKey: string;
  apiEndpoint: string;
  encryptionEnabled: boolean;
}

export interface ConfirmationData {
  confirmed: boolean;
  timestamp?: Date;
}

export type WizardStepData = {
  introduction: IntroductionData;
  authentication: AuthenticationData;
  secureData: SecureData;
  confirmation: ConfirmationData;
};