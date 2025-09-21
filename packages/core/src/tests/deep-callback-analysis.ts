/**
 * DEEP DIVE: Analyzing exactly what's wrong with callback argument typing
 */

import { defineSteps } from '../index';

// Let's trace what happens step by step
const testSteps = defineSteps({
  step1: {
    data: { name: 'test', count: 42 },
    beforeExit: ({ data, ctx, updateContext }) => {
      // Problem: TypeScript says these are 'any'
      // Let's understand WHY

      // What type does TypeScript think 'data' is?
      type DataType = typeof data; // Let's see this

      // Let's check what the callback signature should be
      // by looking at what defineSteps returns

      // What should it be based on our data property?
      type ExpectedDataType = { name: string; count: number };

      console.log(data, ctx, updateContext);
    },
    next: ['step2'],
  },
  step2: {
    validate: ({ data }: { data: { email: string } }) => {
      // This has explicit typing in the validate function
      // Does this help with inference?
    },
    beforeExit: ({ data }) => {
      // What type is data here? Should be inferred from validate
      type ValidateInferredData = typeof data;
      console.log(data);
    },
    next: [],
  },
});

// Let's also check what the step definitions look like after defineSteps
type StepsAfterDefine = typeof testSteps;
type Step1AfterDefine = StepsAfterDefine['step1'];
type Step2AfterDefine = StepsAfterDefine['step2'];

// What does our InferStepData think these should be?
import type { InferStepData } from '../types';
type Step1DataInferred = InferStepData<Step1AfterDefine>;
type Step2DataInferred = InferStepData<Step2AfterDefine>;

export type {
  StepsAfterDefine,
  Step1AfterDefine,
  Step2AfterDefine,
  Step1DataInferred,
  Step2DataInferred,
};