/**
 * Example: Using the builder pattern for type-safe step definitions
 */

import { reactWizardWithContext } from "@wizard/react";
import type { WizardContext } from "./types";

const wizardFactory = reactWizardWithContext<WizardContext>({
  role: 'user',
  requiresApproval: false,
  completedSteps: []
});

// Step 1: Define step names as a union type
type StepName =
  | 'roleSelection'
  | 'userProfile'
  | 'adminPanel'
  | 'managerDashboard'
  | 'sharedReview'
  | 'sendReminder';

// Step 2: Create a builder with the step names
const { step, build } = wizardFactory.builder<StepName>();

// Step 3: Define steps with full type safety
export const steps = build({
  roleSelection: step({
    data: { role: 'user' as const },
    next: ['userProfile', 'adminPanel'], // ✅ Autocomplete works!
    // next: ['invalidStep'], // ❌ TypeScript error!
  }),

  userProfile: step({
    data: { name: '', email: '' },
    next: ['sharedReview'], // ✅ Only valid step names
  }),

  adminPanel: step({
    data: { settings: {} },
    next: ({ context }) => {
      // ✅ Return type is validated
      if (context.role === 'admin') {
        return ['managerDashboard', 'sharedReview'];
      }
      return ['sharedReview'];
    },
  }),

  managerDashboard: step({
    data: {},
    next: ['sendReminder'], // ✅ Type-safe
  }),

  sendReminder: step({
    data: { message: '' },
    next: [], // ✅ Can be empty array
  }),

  sharedReview: step({
    data: { feedback: '' },
    next: [],
  }),
});

// Step 4: Create wizard as usual
export const wizard = wizardFactory.createWizard(steps);
