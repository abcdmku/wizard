/**
 * Debug: Test type extraction step by step
 */

import type { ValOrFn } from '../types';

// Let's test the type extraction logic step by step

// Test step definition
type TestStepDef = {
  validate: (args: { data: { method: string; amount: number } }) => void;
  data: { method: string; amount: number };
  beforeExit: (args: any) => void;
  next: string[];
};

// Test our current ExtractStepData logic
type ExtractStepData<T> =
  T extends { validate: (args: { data: infer ValidateData }) => any }
    ? ValidateData
  : T extends { data: infer DataProp }
    ? DataProp extends ValOrFn<infer DataType, any>
      ? DataType
      : DataProp
  : T extends { beforeEnter: (...args: any[]) => infer ReturnType }
    ? ReturnType extends void ? never : ReturnType
  : never;

// What does our extraction return?
type Result1 = ExtractStepData<TestStepDef>;
// This should be { method: string; amount: number }

// Test just the validate branch
type ValidateBranch<T> = T extends { validate: (args: { data: infer ValidateData }) => any }
  ? ValidateData
  : never;

type Result2 = ValidateBranch<TestStepDef>;

// Test just the data branch
type DataBranch<T> = T extends { data: infer DataProp }
  ? DataProp extends ValOrFn<infer DataType, any>
    ? DataType
    : DataProp
  : never;

type Result3 = DataBranch<TestStepDef>;

// Test simpler case - no validation
type SimpleStepDef = {
  data: { name: string; age: number };
  beforeExit: (args: any) => void;
  next: string[];
};

type Result4 = ExtractStepData<SimpleStepDef>;

// Export for inspection
export type {
  Result1,
  Result2,
  Result3,
  Result4
};