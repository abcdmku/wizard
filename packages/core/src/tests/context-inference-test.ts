/**
 * Test context type inference from createWizard
 */

import { wizardWithContext, createWizardFactory } from '../wizard-factory';

// Define context type
type AppContext = {
  globalFlag: boolean;
  userId: string;
  permissions: string[];
  theme: 'light' | 'dark';
};

// ✅ APPROACH 1: Using wizardWithContext helper
const contextAwareWizard = wizardWithContext<AppContext>({
  globalFlag: true,
  userId: 'user123',
  permissions: ['read', 'write'],
  theme: 'light'
});

const steps1 = contextAwareWizard.defineSteps({
  step1: {
    data: { enabled: true, value: 42 },
    canEnter: ({ context, data }) => {
      // ✅ HOVER TEST: context should be typed as AppContext
      const globalFlag: boolean = context.globalFlag;
      const userId: string = context.userId;
      const permissions: string[] = context.permissions;
      const theme: 'light' | 'dark' = context.theme;

      // ✅ HOVER TEST: data should be typed properly
      const enabled = data?.enabled ?? false;
      const value = data?.value ?? 0;

      return globalFlag && enabled && permissions.includes('read');
    },
    beforeExit: ({ context, data, updateContext }) => {
      // ✅ HOVER TEST: All parameters properly typed
      const globalFlag: boolean = context.globalFlag;
      const enabled: boolean = data.enabled;
      const value: number = data.value;

      console.log(`Context: globalFlag=${globalFlag}, Data: enabled=${enabled}, value=${value}`);

      // ✅ HOVER TEST: updateContext properly typed
      updateContext((ctx) => {
        ctx.theme = ctx.theme === 'light' ? 'dark' : 'light';
        ctx.permissions.push('admin');
      });
    },
    next: ['step2']
  },

  step2: {
    data: { message: 'Hello World' },
    beforeExit: ({ context, data }) => {
      // ✅ HOVER TEST: context and data both properly typed
      const userId: string = context.userId;
      const message: string = data.message;

      console.log(`User ${userId} says: ${message}`);
    },
    next: []
  }
});

const wizard1 = contextAwareWizard.createWizard(steps1);

// ✅ APPROACH 2: Using factory pattern
const factory = createWizardFactory<AppContext>();

const steps2 = factory.defineSteps({
  profile: {
    data: { name: '', email: '', avatar: '' },
    canExit: ({ context, data }) => {
      // ✅ HOVER TEST: context should be AppContext
      const hasPermission = context.permissions.includes('profile:edit');
      const hasValidData = data.name.length > 0 && data.email.includes('@');

      return hasPermission && hasValidData;
    },
    beforeExit: ({ context, data, updateContext }) => {
      // ✅ HOVER TEST: All properly typed
      const name: string = data.name;
      const userId: string = context.userId;

      updateContext((ctx) => {
        ctx.userId = name;
      });
    },
    next: []
  }
});

const wizard2 = factory.createWizard(
  {
    globalFlag: false,
    userId: 'admin',
    permissions: ['admin'],
    theme: 'dark'
  },
  steps2
);

export { wizard1, wizard2, steps1, steps2 };