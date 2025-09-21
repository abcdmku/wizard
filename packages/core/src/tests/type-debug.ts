/**
 * Deep dive into what's happening with type inference
 */

import { defineSteps } from '../index';
import type { InferStepData, DataMapFromDefs } from '../types';

// Define steps with explicit typing to see what happens
const steps = defineSteps({
  step1: {
    data: { name: 'test' as string },
    next: ['step2' as const],
  },
  step2: {
    data: { count: 42 as number },
    next: [] as const,
  },
});

// Let's trace through the type inference manually
type StepsType = typeof steps;

// What does each step definition look like?
type Step1DefType = StepsType['step1'];
type Step2DefType = StepsType['step2'];

// What does InferStepData return for each step?
type Step1InferredData = InferStepData<Step1DefType>;
type Step2InferredData = InferStepData<Step2DefType>;

// What does the final DataMap look like?
type FinalDataMap = DataMapFromDefs<StepsType>;

// Let's also test what specific lookups return
type Step1FromMap = FinalDataMap['step1'];
type Step2FromMap = FinalDataMap['step2'];

// Export all types for inspection
export type {
  StepsType,
  Step1DefType,
  Step2DefType,
  Step1InferredData,
  Step2InferredData,
  FinalDataMap,
  Step1FromMap,
  Step2FromMap,
};

// Test function to demonstrate the problem
function demonstrateProblem() {
  // This is what we expect to work:
  type ExpectedStep1 = { name: string };
  type ExpectedStep2 = { count: number };

  // Check if our inferred types match expectations
  type Step1Matches = Step1InferredData extends ExpectedStep1 ? true : false;
  type Step2Matches = Step2InferredData extends ExpectedStep2 ? true : false;

  // Export for debugging
  type Debug = {
    step1Matches: Step1Matches;
    step2Matches: Step2Matches;
  };
}

export { demonstrateProblem };