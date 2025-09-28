import { createWizard, defineSteps } from "@wizard/core";
import type { WizardContext, WizardStepData, UserRole } from "./types";
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
};

export const steps = defineSteps({
  roleSelection: {
    data: initialData.roleSelection,
    next: ({ data, ctx }) => {
      return determineNextStep('roleSelection', data.role, ctx);
    },
    beforeExit: ({ data, updateContext }) => {
      updateContext((ctx: WizardContext) => {
        ctx.role = data.role;
        ctx.completedSteps.push('roleSelection');
      });
    },
    meta: { 
      label: 'Select Role',
      description: 'Choose your role to customize the wizard experience'
    }
  },
  
  userProfile: {
    data: initialData.userProfile,
    canEnter: ({ ctx }) => canAccessStep('userProfile', ctx.role, ctx),
    next: ({ ctx }) => determineNextStep('userProfile', ctx.role, ctx),
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
      updateContext((ctx: WizardContext) => {
        ctx.completedSteps.push('userProfile');
      });
    },
    meta: { 
      label: 'User Profile',
      description: 'Enter your personal information',
      visibleTo: ['user']
    }
  },
  
  adminPanel: {
    data: initialData.adminPanel,
    canEnter: ({ ctx }) => canAccessStep('adminPanel', ctx.role, ctx),
    next: ({ data, ctx }) => {
      // Update context first
      ctx.requiresApproval = data.requiresApproval;
      return determineNextStep('adminPanel', ctx.role, ctx);
    },
    beforeExit: ({ data, updateContext }) => {
      updateContext((ctx: WizardContext) => {
        ctx.requiresApproval = data.requiresApproval;
        ctx.completedSteps.push('adminPanel');
      });
    },
    meta: { 
      label: 'Admin Settings',
      description: 'Configure system-wide settings',
      visibleTo: ['admin']
    }
  },
  
  managerDashboard: {
    data: initialData.managerDashboard,
    canEnter: ({ ctx }) => canAccessStep('managerDashboard', ctx.role, ctx),
    next: ({ ctx }) => determineNextStep('managerDashboard', ctx.role, ctx),
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
      updateContext((ctx: WizardContext) => {
        ctx.completedSteps.push('managerDashboard');
      });
    },
    meta: { 
      label: 'Manager Dashboard',
      description: 'Configure team and budget settings',
      visibleTo: ['manager', 'admin']
    }
  },
  
  sharedReview: {
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
      updateContext((ctx: WizardContext) => {
        ctx.completedSteps.push('sharedReview');
      });
    },
    meta: { 
      label: 'Review & Feedback',
      description: 'Share your experience and feedback'
    }
  },
});

export const branchingWizard = createWizard({
  context: {
    role: '' as UserRole | '',
    requiresApproval: false,
    completedSteps: []
  } as WizardContext,
  steps,
});