
export type UserRole = 'user' | 'admin' | 'manager';

export type StepName =
  | 'roleSelection'
  | 'userProfile'
  | 'adminPanel'
  | 'managerDashboard'
  | 'sharedReview'
  | 'sendReminder'
  | 'new';

export interface WizardContext {
  role: UserRole | '';
  requiresApproval: boolean;
  completedSteps: StepName[];
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

export interface SendReminderData {
  userId: number;
  userName: string;
  scheduleType: 'now' | 'later' | 'custom';
  customDate?: string;
  message: string;
}

export type WizardStepData = {
  roleSelection: RoleSelectionData;
  userProfile: UserProfileData;
  adminPanel: AdminPanelData;
  managerDashboard: ManagerDashboardData;
  sharedReview: SharedReviewData;
  sendReminder: SendReminderData;
};

export type WizardSteps = keyof WizardStepData;