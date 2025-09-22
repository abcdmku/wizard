/**
 * Example showing how to properly type context with globalFlag property
 */

import { defineSteps } from '../index';

// Define your context type with globalFlag
type AppContext = {
  globalFlag: boolean;
  userId: string;
  settings: Record<string, any>;
};

// ✅ CORRECT: Explicitly type all callback parameters
const contextSteps = defineSteps({
  step1: {
    data: { enabled: true, value: 42 },
    canEnter: ({
      context,
      data
    }: {
      context: AppContext;
      data: { enabled: boolean; value: number } | undefined;
    }) => {
      // ✅ context.globalFlag is properly typed!
      const hasGlobalFlag: boolean = context.globalFlag;
      const isEnabled = data?.enabled ?? false;

      return hasGlobalFlag && isEnabled;
    },
    beforeExit: ({
      context,
      data,
      updateContext
    }: {
      context: AppContext;
      data: { enabled: boolean; value: number };
      updateContext: (fn: (context: AppContext) => void) => void;
    }) => {
      // ✅ All properties properly typed
      const globalFlag: boolean = context.globalFlag;
      const userId: string = context.userId;
      const enabled: boolean = data.enabled;
      const value: number = data.value;

      console.log(`Global flag: ${globalFlag}, User: ${userId}, Enabled: ${enabled}, Value: ${value}`);

      // ✅ Update context with proper typing
      updateContext((ctx) => {
        ctx.globalFlag = !ctx.globalFlag;
        ctx.settings.lastStep = 'step1';
      });
    },
    next: []
  }
});

// Alternative using helper function (requires null checking)
import { step } from '../index';

const helperSteps = defineSteps({
  step1: step({
    data: { enabled: true, value: 42 },
    canEnter: ({ context, data }) => {
      // ❌ This will still show context as unknown without explicit typing
      // You need to cast or use explicit parameter typing
      const ctx = context as AppContext;
      return ctx.globalFlag && Boolean(data?.enabled);
    },
    next: []
  })
});

export { contextSteps, helperSteps };
export type { AppContext };