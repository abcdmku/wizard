/**
 * Test type inference in isolation without wizard creation
 */

import type { InferStepData, DataMapFromDefs } from '../types';

// Test individual step type inference
type TestStep1 = {
  data: { method: string; amount: number };
  next: ['step2'];
};

type TestStep2 = {
  data: { confirmed: boolean };
  next: [];
};

// Test InferStepData on individual steps
type Step1Data = InferStepData<TestStep1>; // Should be { method: string; amount: number }
type Step2Data = InferStepData<TestStep2>; // Should be { confirmed: boolean }

// Test DataMapFromDefs
type TestSteps = {
  step1: TestStep1;
  step2: TestStep2;
};

type TestDataMap = DataMapFromDefs<TestSteps>; // Should be { step1: { method: string; amount: number }, step2: { confirmed: boolean } }

// Test individual lookups
type Step1FromMap = TestDataMap['step1']; // Should be { method: string; amount: number }
type Step2FromMap = TestDataMap['step2']; // Should be { confirmed: boolean }

// Test if these match our expectations
type Step1Correct = Step1FromMap extends { method: string; amount: number } ? true : false;
type Step2Correct = Step2FromMap extends { confirmed: boolean } ? true : false;

// Export for verification
export type {
  Step1Data,
  Step2Data,
  TestDataMap,
  Step1FromMap,
  Step2FromMap,
  Step1Correct,
  Step2Correct,
};