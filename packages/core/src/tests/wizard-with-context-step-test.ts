/**
 * Test wizardWithContext now includes step function
 */

import { wizardWithContext } from '../wizard-factory';

type AppContext = {
  globalFlag: boolean;
  userId: string;
  permissions: string[];
};

// Create wizard with context
const { defineSteps, step, createWizard } = wizardWithContext<AppContext>({
  globalFlag: true,
  userId: 'test-user',
  permissions: ['read', 'write']
});

// ✅ Now we can use the step function directly!
const steps = defineSteps({
  profile: step({
    data: { name: '', email: '', avatar: '' },
    canEnter: ({ context, data }) => {
      // ✅ HOVER TEST: context should be typed as AppContext
      const hasPermission = context.permissions.includes('profile:edit');
      const isEnabled = context.globalFlag;
      const hasData = Boolean(data?.name && data?.email);

      return hasPermission && isEnabled && hasData;
    },
    beforeExit: ({ context, data, updateContext }) => {
      // ✅ HOVER TEST: All parameters properly typed
      const name: string = data.name;
      const userId: string = context.userId;
      const permissions: string[] = context.permissions;

      console.log(`Profile: ${name}, User: ${userId}, Permissions: ${permissions.join(', ')}`);

      updateContext((ctx) => {
        // ✅ HOVER TEST: ctx should be typed as AppContext
        ctx.userId = name;
        ctx.permissions.push('profile:updated');
      });
    },
    next: ['settings']
  }),

  settings: step({
    data: { notifications: true, theme: 'dark' as const },
    canExit: ({ context, data }) => {
      // ✅ HOVER TEST: Both properly typed
      const globalFlag: boolean = context.globalFlag;
      const notifications: boolean = data.notifications;

      return globalFlag && notifications;
    },
    beforeExit: ({ context, data }) => {
      // ✅ HOVER TEST: Proper typing
      const userId: string = context.userId;
      const theme: 'dark' = data.theme;

      console.log(`Settings saved for ${userId}: theme=${theme}`);
    },
    next: []
  })
});

// Create the wizard
const wizard = createWizard(steps);

// Test wizard methods
const current = wizard.getCurrent();
console.log('Current step:', current.step);
console.log('Current context:', current.context);

export { wizard, steps };