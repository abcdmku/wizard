/**
 * Simple test to isolate the validate inference issue
 */

import { defineSteps } from '../index';

// Simplest possible test
const simpleValidate = defineSteps({
  test: {
    validate: ({ data }: { data: { name: string } }) => {
      // Simple validation
    },
    beforeExit: ({ data }) => {
      // Test if data is properly typed
      const name: string = data.name; // This should work
      console.log(name);
    },
    next: [],
  },
});

// Test with data property
const simpleData = defineSteps({
  test: {
    data: { count: 42 },
    beforeExit: ({ data }) => {
      // Test if data is properly typed
      const count: number = data.count; // This should work
      console.log(count);
    },
    next: [],
  },
});

export { simpleValidate, simpleData };