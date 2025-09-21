/**
 * Test callback argument typing with improved defineSteps
 */

import { defineSteps } from '../index';

// Test with properly typed callbacks
const callbackTest = defineSteps({
  step1: {
    data: { name: 'test', count: 42 },
    beforeExit: ({ data, ctx, updateContext }) => {
      // These should be properly typed now:
      // data: { name: string; count: number }
      // ctx: unknown (default)
      // updateContext: (fn: (ctx: unknown) => void) => void

      const name: string = data.name; // Should work
      const count: number = data.count; // Should work

      updateContext((context) => {
        // context should be typed as unknown (default)
        console.log('Context updated');
      });

      console.log(`Name: ${name}, Count: ${count}`);
    },
    next: ['step2'],
  },
  step2: {
    data: { success: true },
    next: [],
  },
});

export { callbackTest };