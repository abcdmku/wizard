import type { UserRole, WizardContext } from "./types";

export const determineNextStep = (
  currentStep: string,
  role: UserRole | '',
  context: WizardContext
): string[] => {
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
      // Conditional based on admin action
      if (context.requiresApproval) {
        return ['managerDashboard'];
      }
      return ['sharedReview'];
    
    case 'managerDashboard':
      return ['sharedReview'];
    
    case 'userProfile':
      return ['sharedReview'];
    
    case 'sharedReview':
      return []; // Final step
    
    default:
      return [];
  }
};

export const getAvailableStepsForRole = (role: UserRole | ''): string[] => {
  const commonSteps = ['roleSelection', 'sharedReview'];
  
  switch (role) {
    case 'admin':
      return [...commonSteps, 'adminPanel', 'managerDashboard'];
    case 'manager':
      return [...commonSteps, 'managerDashboard'];
    case 'user':
      return [...commonSteps, 'userProfile'];
    default:
      return ['roleSelection'];
  }
};

export const canAccessStep = (
  step: string,
  role: UserRole | '',
  context: WizardContext
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
      return role === 'manager' || (role === 'admin' && context.requiresApproval);
    
    case 'userProfile':
      return role === 'user';
    
    case 'sharedReview':
      return true; // All roles can access final review
    
    default:
      return false;
  }
};