/**
 * Test the factory.step() approach for context typing
 */

import { createWizardFactory } from '../wizard-factory';

type AppContext = {
  globalFlag: boolean;
  userId: string;
  permissions: string[];
};

// Create factory with context type
const factory = createWizardFactory<AppContext>();

// Test using factory.step() which should provide better typing
const steps = factory.defineSteps({
  step1: factory.step({
    data: { enabled: true, value: 42 },
    canEnter: ({ context, data }) => {
      // ✅ HOVER TEST: context should be properly typed as AppContext
      // ✅ HOVER TEST: data should be properly typed
      if (data) {
        const globalFlag: boolean = context.globalFlag;
        const enabled: boolean = data.enabled;
        return globalFlag && enabled;
      }
      return false;
    },
    beforeExit: ({ context, data, updateContext }) => {
      // ✅ HOVER TEST: All parameters should be properly typed
      const userId: string = context.userId;
      const enabled: boolean = data.enabled;
      const value: number = data.value;

      console.log(`User: ${userId}, enabled: ${enabled}, value: ${value}`);

      updateContext((ctx) => {
        ctx.permissions.push('completed-step1');
      });
    },
    next: []
  })
});

const wizard = factory.createWizard(
  {
    globalFlag: true,
    userId: 'test-user',
    permissions: ['read']
  },
  steps
);

export { wizard, steps };