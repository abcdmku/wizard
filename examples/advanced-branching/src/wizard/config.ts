import { defineSteps, step, createWizard } from "./factory";
import { useWizard, useWizardStep } from "@wizard/react";
import type { WizardStepData } from "./types";
import { determineNextStep, canAccessStep } from "./navigation";

const initialData: WizardStepData = {
  roleSelection: { role: 'user' },
  userProfile: {
    firstName: '',
    lastName: '',
    email: '',
    department: '',
  },
  adminPanel: {
    settings: {
      allowRegistration: true,
      requireEmailVerification: false,
      maintenanceMode: false,
    },
    requiresApproval: false,
  },
  managerDashboard: {
    teamSize: 0,
    budget: 0,
    approvalThreshold: 1000,
    delegateApprovals: false,
  },
  sharedReview: {
    feedback: '',
    rating: 5,
    subscribe: false,
  },
  sendReminder: {
    userId: 0,
    userName: '',
    scheduleType: 'later',
    message: '',
  },
};

export const steps = defineSteps({
  roleSelection: step({
    data: initialData.roleSelection,
    next: ({ data, context }) => {
      return determineNextStep('roleSelection', data.role, context);
    },
    beforeExit: ({ data, updateContext }) => {
      updateContext((ctx) => {
        ctx.role = data.role;
        ctx.completedSteps.push('roleSelection');
      });
    },
    meta: { 
      label: 'Select Role',
      description: 'Choose your role to customize the wizard experience'
    }
  }),
  
  userProfile: step({
    data: initialData.userProfile,
    canEnter: ({ context }) => canAccessStep('userProfile', context.role, context),
    next: ({ context }) => determineNextStep('userProfile', context.role, context),
    validate: ({ data }) => {
      const d = data as typeof initialData.userProfile;
      if (!d.firstName || !d.lastName) {
        throw new Error('Please enter your full name');
      }
      if (!d.email || !d.email.includes('@')) {
        throw new Error('Please enter a valid email');
      }
      if (!d.department) {
        throw new Error('Please select a department');
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx) => {
        ctx.completedSteps.push('userProfile');
      });
    },
    meta: {
      label: 'User Profile',
      description: 'Enter your personal information'
    }
  }),
  
  adminPanel: step({
    data: initialData.adminPanel,
    canEnter: ({ context }) => canAccessStep('adminPanel', context.role, context),
    next: ({ context }) => {
      return determineNextStep('adminPanel', context.role, context);
    },
    beforeExit: ({ data, updateContext }) => {
      updateContext((ctx) => {
        ctx.requiresApproval = data.requiresApproval;
        ctx.completedSteps.push('adminPanel');
      });
    },
    meta: {
      label: 'Admin Settings',
      description: 'Configure system-wide settings'
    }
  }),
  
  managerDashboard: step({
    data: initialData.managerDashboard,
    canEnter: ({ context }) => canAccessStep('managerDashboard', context.role, context),
    next: ({ context }) => determineNextStep('managerDashboard', context.role, context),
    validate: ({ data }) => {
      const d = data as typeof initialData.managerDashboard;
      if (d.teamSize < 0) {
        throw new Error('Team size cannot be negative');
      }
      if (d.budget < 0) {
        throw new Error('Budget cannot be negative');
      }
      if (d.approvalThreshold < 0) {
        throw new Error('Approval threshold cannot be negative');
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx) => {
        ctx.completedSteps.push('managerDashboard');
      });
    },
    meta: {
      label: 'Manager Dashboard',
      description: 'Configure team and budget settings'
    }
  }),
  
  sharedReview: step({
    data: initialData.sharedReview,
    next: [],
    validate: ({ data }) => {
      const d = data as typeof initialData.sharedReview;
      if (!d.feedback || d.feedback.length < 10) {
        throw new Error('Please provide at least 10 characters of feedback');
      }
      if (d.rating < 1 || d.rating > 10) {
        throw new Error('Rating must be between 1 and 10');
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx) => {
        ctx.completedSteps.push('sharedReview');
      });
    },
    meta: {
      label: 'Review & Feedback',
      description: 'Share your experience and feedback'
    }
  }),

  sendReminder: step({
    data: initialData.sendReminder,
    canEnter: ({ context }) => context.role === 'manager',
    next: () => ['managerDashboard'], // Loop back to dashboard
    validate: ({ data }) => {
      const d = data as typeof initialData.sendReminder;
      if (!d.message || d.message.length < 5) {
        throw new Error('Please provide a reminder message (minimum 5 characters)');
      }
      if (d.scheduleType === 'custom' && !d.customDate) {
        throw new Error('Please select a date for custom scheduling');
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx) => {
        ctx.completedSteps.push('sendReminder');
      });
    },
    meta: {
      label: 'Send Reminder',
      description: 'Schedule a reminder for team member'
    }
  }),
});

export const branchingWizard = createWizard(steps) as ReturnType<typeof createWizard<typeof steps>>;

/**
 * Typed convenience hook for using branchingWizard.
 * This eliminates the need to pass branchingWizard to useWizard in every component.
 */
export const useBranchingWizard = () => useWizard(branchingWizard);

/**
 * Step-specific typed convenience hooks.
 * These provide direct access to individual steps with full type safety.
 */
export const useRoleSelectionStep = () => useWizardStep(branchingWizard, "roleSelection");
export const useUserProfileStep = () => useWizardStep(branchingWizard, "userProfile");
export const useAdminPanelStep = () => useWizardStep(branchingWizard, "adminPanel");
export const useManagerDashboardStep = () => useWizardStep(branchingWizard, "managerDashboard");
export const useSharedReviewStep = () => useWizardStep(branchingWizard, "sharedReview");
export const useSendReminderStep = () => useWizardStep(branchingWizard, "sendReminder");