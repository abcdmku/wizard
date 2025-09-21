/**
 * DEEP DIVE: Understanding the constraint system
 */

import type {
  StepDefinition,
  PartialStepDefinition,
  InferStepData,
  StepArgs,
  StepExitArgs
} from '../types';

// The problem: defineSteps doesn't apply proper constraints
// Let's understand what SHOULD happen vs what DOES happen

// Step 1: What should a step definition look like?
type IdealStepDef = {
  data: { name: string; count: number };
  beforeExit: (args: StepExitArgs<unknown, string, { name: string; count: number }, never>) => void;
  next: string[];
};

// Step 2: What does our current defineSteps produce?
import { defineSteps } from '../index';

const currentResult = defineSteps({
  test: {
    data: { name: 'test', count: 42 },
    beforeExit: ({ data }) => {
      // data is 'any' - this is the problem
      const test: any = data; // This works
      // const test: { name: string; count: number } = data; // This should work but doesn't
    },
    next: ['step2'],
  },
});

type CurrentResultType = typeof currentResult;
type CurrentTestStep = CurrentResultType['test'];

// Step 3: What should InferStepData return for this?
type InferredFromCurrent = InferStepData<CurrentTestStep>;

// Step 4: Let's trace the inference chain manually
// CurrentTestStep should have: { data: { name: string; count: number }, ... }
// InferStepData should extract the data type
// But callbacks should use that inferred type

// The issue is likely that defineSteps returns the input type as-is
// without transforming it to have proper callback constraints

// Let's check what PartialStepDefinition expects
type WhatPartialExpects<Data> = PartialStepDefinition<unknown, string, never, { data: Data }>;
type TestPartial = WhatPartialExpects<{ name: string; count: number }>;

// Check the beforeExit signature in PartialStepDefinition
type BeforeExitFromPartial = TestPartial['beforeExit'];

export type {
  IdealStepDef,
  CurrentResultType,
  CurrentTestStep,
  InferredFromCurrent,
  TestPartial,
  BeforeExitFromPartial,
};