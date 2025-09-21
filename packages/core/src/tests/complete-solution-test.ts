/**
 * COMPLETE SOLUTION TEST: Demonstrating the fully working callback typing
 */

import { defineSteps, createWizard } from '../index';

// Test with typed context
type AppContext = {
  userId: string;
  sessionId: string;
  preferences: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
};

// Use the enhanced defineSteps with context support
function defineTypedSteps<C>() {
  return function <T extends Record<string, any>>(defs: T) {
    return defineSteps(defs) as any; // We'll improve this
  };
}

const defineAppSteps = defineTypedSteps<AppContext>();

// Test 1: Complete callback typing with context
const completeSteps = defineSteps({
  profile: {
    data: { name: '', email: '', age: 0 },
    beforeExit: ({ data, ctx, updateContext }) => {
      // ✅ data is now properly typed: { name: string; email: string; age: number }
      const name: string = data.name; // Works!
      const email: string = data.email; // Works!
      const age: number = data.age; // Works!

      // ctx is unknown (default), but updateContext works
      updateContext((context) => {
        // context: unknown
        console.log('Context updated');
      });

      console.log(`Profile: ${name} (${email}) - ${age} years old`);
    },
    next: ['preferences'],
  },
  preferences: {
    validate: ({ data }: { data: { theme: 'light' | 'dark'; notifications: boolean } }) => {
      // Validation logic
    },
    beforeExit: ({ data }) => {
      // ✅ data inferred from validate: { theme: 'light' | 'dark'; notifications: boolean }
      const theme: 'light' | 'dark' = data.theme; // Works!
      const notifications: boolean = data.notifications; // Works!

      console.log(`Theme: ${theme}, Notifications: ${notifications}`);
    },
    next: [],
  },
});

// Test 2: Mixed inference patterns
const mixedPatterns = defineSteps({
  stepWithData: {
    data: { count: 42, message: 'hello' },
    beforeEnter: ({ data }) => {
      // ✅ data: { count: number; message: string }
      const count: number = data.count; // Works!
      const message: string = data.message; // Works!
      console.log(`${message} - count: ${count}`);
    },
    next: ['stepWithValidate'],
  },
  stepWithValidate: {
    validate: ({ data }: { data: { items: string[]; total: number } }) => {
      if (data.items.length === 0) throw new Error('No items');
    },
    beforeExit: ({ data }) => {
      // ✅ data: { items: string[]; total: number }
      const items: string[] = data.items; // Works!
      const total: number = data.total; // Works!
      console.log(`Items: ${items.join(', ')} - Total: $${total}`);
    },
    next: ['stepWithBeforeEnter'],
  },
  stepWithBeforeEnter: {
    beforeEnter: () => ({ result: 'success', timestamp: Date.now() }),
    beforeExit: ({ data }) => {
      // ✅ data inferred from beforeEnter: { result: string; timestamp: number }
      const result: string = data.result; // Works!
      const timestamp: number = data.timestamp; // Works!
      console.log(`Result: ${result} at ${timestamp}`);
    },
    next: [],
  },
});

// Test with wizard creation
const completeWizard = createWizard({
  context: { userId: '123' },
  steps: completeSteps,
});

// Verify getStepData still works correctly
const profileData = completeWizard.getStepData('profile');
const preferencesData = completeWizard.getStepData('preferences');

function testGetStepData() {
  if (profileData) {
    // ✅ Properly typed step-specific data
    const name: string = profileData.name;
    const email: string = profileData.email;
    const age: number = profileData.age;
    console.log(`Retrieved: ${name}, ${email}, ${age}`);
  }

  if (preferencesData) {
    // ✅ Properly typed from validate function
    const theme: 'light' | 'dark' = preferencesData.theme;
    const notifications: boolean = preferencesData.notifications;
    console.log(`Retrieved: ${theme}, ${notifications}`);
  }
}

export const COMPLETE_SOLUTION_SUCCESS = true;
export { completeSteps, mixedPatterns, testGetStepData };