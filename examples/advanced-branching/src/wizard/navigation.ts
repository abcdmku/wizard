import type { UserRole, WizardContext } from "./types";
import type { StepName } from "./types";

export const determineNextStep = (
  currentStep: StepName,
  role: UserRole | '',
  _context: WizardContext
): StepName[] => {
  switch (currentStep) {
    case 'roleSelection':
      // Branch based on selected role
      switch (role) {
        case 'admin':
          return ['adminPanel'];
        case 'manager':
          return ['managerDashboard'];
        case 'user':
          return ['userProfile'];
        default:
          return [];
      }

    case 'adminPanel':
      // Admin sees all data, ends here (final step)
      return [];

    case 'managerDashboard':
      // Manager can send reminders or end here
      return ['sendReminder'];

    case 'userProfile':
      // User goes to review after profile
      return ['sharedReview'];

    case 'sharedReview':
      return []; // Final step for users

    default:
      return [];
  }
};

export const getAvailableStepsForRole = (role: UserRole | ''): StepName[] => {
  switch (role) {
    case 'admin':
      return ['roleSelection', 'adminPanel'];
    case 'manager':
      return ['roleSelection', 'managerDashboard'];
    case 'user':
      return ['roleSelection', 'userProfile', 'sharedReview'];
    default:
      return ['roleSelection'];
  }
};

export const canAccessStep = (
  step: string,
  role: UserRole | '',
  _context: WizardContext
): boolean => {
  // Always can access role selection
  if (step === 'roleSelection') return true;

  // Must have a role selected for other steps
  if (!role) return false;

  // Check role-specific access
  switch (step) {
    case 'adminPanel':
      return role === 'admin';

    case 'managerDashboard':
      return role === 'manager';

    case 'userProfile':
      return role === 'user';

    case 'sharedReview':
      return role === 'user'; // Only users fill out feedback

    default:
      return false;
  }
};
