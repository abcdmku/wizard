/**
 * Debug validate function inference specifically
 */

import { defineSteps } from '../index';
import type { InferStepData } from '../types';

// Test validate function inference
const validateTest = defineSteps({
  testStep: {
    validate: ({ data }: { data: { theme: 'light' | 'dark'; notifications: boolean } }) => {
      // Validation logic
    },
    next: [],
  },
});

// Check what InferStepData returns for this
type TestStepDef = typeof validateTest['testStep'];
type InferredData = InferStepData<TestStepDef>;

// What should it be?
type ExpectedData = { theme: 'light' | 'dark'; notifications: boolean };

// Check if they match
type DoesMatch = InferredData extends ExpectedData ? true : false;

// Let's also test with beforeExit to see the callback args
const validateWithCallback = defineSteps({
  testCallback: {
    validate: ({ data }: { data: { email: string; password: string } }) => {
      if (!data.email) throw new Error('Invalid');
    },
    beforeExit: ({ data }) => {
      // What type is data here?
      type CallbackDataType = typeof data;

      // Let's test accessing properties
      // const email: string = data.email; // Does this work?
      console.log(data);
    },
    next: [],
  },
});

export type {
  TestStepDef,
  InferredData,
  ExpectedData,
  DoesMatch,
};