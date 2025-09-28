export type UserRole = 'user' | 'admin' | 'manager';

export interface WizardContext {
  role: UserRole | '';
  requiresApproval: boolean;
  completedSteps: string[];
}

export interface RoleSelectionData {
  role: UserRole;
}

export interface UserProfileData {
  firstName: string;
  lastName: string;
  email: string;
  department: string;
}

export interface AdminPanelData {
  settings: {
    allowRegistration: boolean;
    requireEmailVerification: boolean;
    maintenanceMode: boolean;
  };
  requiresApproval: boolean;
}

export interface ManagerDashboardData {
  teamSize: number;
  budget: number;
  approvalThreshold: number;
  delegateApprovals: boolean;
}

export interface SharedReviewData {
  feedback: string;
  rating: number;
  subscribe: boolean;
}

export type WizardStepData = {
  roleSelection: RoleSelectionData;
  userProfile: UserProfileData;
  adminPanel: AdminPanelData;
  managerDashboard: ManagerDashboardData;
  sharedReview: SharedReviewData;
};

export type WizardSteps = keyof WizardStepData;