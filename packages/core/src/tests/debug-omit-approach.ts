/**
 * Debug the Omit approach to see what's happening with types
 */

import { defineSteps } from '../index';

// Simple test case
const debugSteps = defineSteps({
  test: {
    data: { name: 'John', age: 30 },
    beforeExit: ({ data }) => {
      // Let's see what type 'data' has here
      const name: string = data.name;
      const age: number = data.age;
      console.log(name, age);
    }
  }
});

// Let's check the actual types
type DebugStepsType = typeof debugSteps;
type TestStepType = DebugStepsType['test'];

// What does the beforeExit look like?
type BeforeExitType = TestStepType['beforeExit'];

export { debugSteps };