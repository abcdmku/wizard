/**
 * Debug the exact types being inferred in node-saga-wizard pattern
 */

import { defineSteps } from '../index';

// Exact validate function like in node-saga-wizard
const validateInit = ({ data }: { data: unknown }) => {
  console.log(data);
};

// Step definition exactly like node-saga-wizard
const stepDef = {
  validate: validateInit,
  data: { orderId: '', customerId: '', totalAmount: 0 },
  beforeExit: ({ data, updateContext }: any) => {
    console.log(data, updateContext);
  },
};

// Now see what happens when we use defineSteps
const testSteps = defineSteps({
  init: stepDef,
});

// Let's extract types to see what's happening
type StepDefType = typeof stepDef;
type ValidateType = StepDefType['validate'];
type DataType = StepDefType['data'];

// Check what the validate function infers
type ValidateDataType = Parameters<ValidateType>[0]['data']; // This should be unknown

// Check if our conditional is working
type TestCondition = StepDefType extends { validate: (args: { data: infer Data }) => any; data: infer FallbackData }
  ? Data extends unknown
    ? { usesFallback: true; fallbackData: FallbackData }
    : { usesFallback: false; inferredData: Data }
  : { noMatch: true };

// What does defineSteps actually return?
type ResultType = typeof testSteps;
type InitStepType = ResultType['init'];
type BeforeExitType = InitStepType['beforeExit'];

export {
  testSteps,
  type ValidateDataType,
  type TestCondition,
  type BeforeExitType
};