/**
 * Test proper context typing with explicit parameter annotation
 */

import { defineSteps } from '../index';

// Define a context type
type AppContext = {
  userId: string;
  permissions: string[];
  theme: 'light' | 'dark';
};

// ✅ WORKING: Explicit typing with proper context
const contextSteps = defineSteps({
  profile: {
    data: { name: '', email: '', avatar: '' },
    beforeExit: ({
      data,
      context,
      updateContext
    }: {
      data: { name: string; email: string; avatar: string };
      context: AppContext;
      updateContext: (fn: (context: AppContext) => void) => void;
    }) => {
      // ✅ data is properly typed
      const name: string = data.name;
      const email: string = data.email;

      // ✅ context is properly typed as AppContext
      const userId: string = context.userId;
      const permissions: string[] = context.permissions;
      const theme: 'light' | 'dark' = context.theme;

      console.log(`User: ${name} (${email}), ID: ${userId}, Theme: ${theme}`);

      // ✅ updateContext is properly typed
      updateContext((ctx) => {
        // ctx is typed as AppContext
        ctx.theme = theme === 'light' ? 'dark' : 'light';
      });
    },
    canExit: ({
      data,
      context
    }: {
      data: { name: string; email: string; avatar: string };
      context: AppContext;
    }) => {
      // ✅ Both data and context properly typed
      const hasPermission = context.permissions.includes('profile:edit');
      const hasValidData = data.name.length > 0 && data.email.includes('@');
      return hasPermission && hasValidData;
    },
    next: ['settings']
  },

  settings: {
    data: { notifications: true, privacy: 'public' },
    beforeExit: ({
      data,
      context
    }: {
      data: { notifications: boolean; privacy: string };
      context: AppContext;
    }) => {
      // ✅ Both properly typed
      const notifications: boolean = data.notifications;
      const privacy: string = data.privacy;
      const userId: string = context.userId;

      console.log(`Settings for ${userId}: notifications=${notifications}, privacy=${privacy}`);
    },
    next: []
  }
});

// Test with validation
const validatedContextSteps = defineSteps({
  authentication: {
    validate: ({ data }: { data: { username: string; password: string } }) => {
      if (!data.username || data.password.length < 8) {
        throw new Error('Invalid credentials');
      }
    },
    data: { username: '', password: '' },
    beforeExit: ({
      data,
      context,
      updateContext
    }: {
      data: { username: string; password: string };
      context: AppContext;
      updateContext: (fn: (context: AppContext) => void) => void;
    }) => {
      // ✅ data typed from validation function
      const username: string = data.username;
      const password: string = data.password;

      // ✅ context properly typed
      const currentUserId: string = context.userId;

      console.log(`Authenticating ${username} (current: ${currentUserId})`);

      // ✅ Update context with proper typing
      updateContext((ctx) => {
        ctx.userId = username;
        ctx.permissions = ['user:read', 'profile:edit'];
      });
    },
    next: []
  }
});

export { contextSteps, validatedContextSteps };
export type { AppContext };