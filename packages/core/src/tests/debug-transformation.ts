/**
 * Debug why the transformation isn't working
 */

import { defineSteps } from '../index';

// Let's check what defineSteps actually returns
const result = defineSteps({
  test: {
    data: { name: 'test', count: 42 },
    beforeExit: ({ data }) => {
      // What type is data here?
      const test: any = data; // Does this cause an error?
      console.log(data);
    },
    next: [],
  },
});

// Check the type of the result
type ResultType = typeof result;
type TestStepType = ResultType['test'];
type BeforeExitType = TestStepType['beforeExit'];

// Let's also test if the constraint is working
import type { StepDefInput, TransformStepDefs } from '../types';

// Test the transformation manually
type TestInput = {
  test: {
    data: { name: string; count: number };
    beforeExit: (args: any) => void;
    next: string[];
  };
};

type ShouldBeTransformed = TransformStepDefs<TestInput>;
type TransformedTestStep = ShouldBeTransformed['test'];
type TransformedBeforeExit = TransformedTestStep['beforeExit'];

export type {
  ResultType,
  TestStepType,
  BeforeExitType,
  ShouldBeTransformed,
  TransformedTestStep,
  TransformedBeforeExit,
};