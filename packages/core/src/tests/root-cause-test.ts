/**
 * ROOT CAUSE: Testing what happens when we force proper constraints
 */

import type { PartialStepDefinition, InferStepData } from '../types';

// Let's manually create what defineSteps SHOULD produce
type ManualStepDef = {
  test: PartialStepDefinition<unknown, 'test', never, { data: { name: string; count: number } }>;
};

// Check what InferStepData would return for this
type InferredFromManual = InferStepData<ManualStepDef['test']>;

// The problem is that defineSteps can't know the data type ahead of time
// to apply the PartialStepDefinition constraint properly.

// But wait - let's check if we can use a mapped type approach:
type TransformStepDefs<T extends Record<string, any>> = {
  [K in keyof T]: PartialStepDefinition<unknown, K & string, never, T[K]>
};

// Test this transformation
type TestInput = {
  step1: {
    data: { name: string; count: number };
    beforeExit: (args: any) => void;
    next: string[];
  };
};

type Transformed = TransformStepDefs<TestInput>;
type TransformedStep1 = Transformed['step1'];
type TransformedBeforeExit = TransformedStep1['beforeExit'];

// This should give us the proper callback signature!

export type {
  ManualStepDef,
  InferredFromManual,
  Transformed,
  TransformedStep1,
  TransformedBeforeExit,
};