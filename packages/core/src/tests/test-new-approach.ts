/**
 * Test the new direct approach to callback typing
 */

import { defineSteps } from '../index';

// Test the approach that should work now
const newApproachTest = defineSteps({
  payment: {
    validate: ({ data }: { data: { method: string; amount: number } }) => {
      if (!data.method || data.amount <= 0) throw new Error('Invalid payment');
    },
    beforeExit: ({ data }) => {
      // This should now be properly typed!
      const method: string = data.method; // Should work without 'any' error
      const amount: number = data.amount; // Should work without 'any' error
      console.log(`Payment: ${method} for $${amount}`);
    },
    next: ['confirmation'],
  },
  profile: {
    data: { name: 'John', age: 30 },
    beforeExit: ({ data }) => {
      // This should also be properly typed from data property!
      const name: string = data.name; // Should work
      const age: number = data.age;   // Should work
      console.log(`Profile: ${name}, age ${age}`);
    },
    next: [],
  },
});

export { newApproachTest };