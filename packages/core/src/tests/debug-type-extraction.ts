/**
 * Debug: Test what ExtractCallbackDataType is actually extracting
 */

// Test step definition
type TestStepDef = {
  validate: (args: { data: { method: string; amount: number } }) => void;
  data: { method: string; amount: number };
  beforeExit: (args: any) => void;
  next: string[];
};

// What does ExtractCallbackDataType extract?
type ExtractCallbackDataType<T> =
  T extends { validate: (args: { data: infer ValidateData }) => any; data: infer DataProp }
    ? ValidateData extends unknown ? DataProp : ValidateData
    : T extends { validate: (args: { data: infer ValidateData }) => any }
    ? ValidateData
    : T extends { data: infer DataProp }
    ? DataProp
    : T extends { beforeEnter: (...args: any[]) => infer ReturnType }
    ? ReturnType extends void ? unknown : ReturnType
    : unknown;

// Test the extraction
type Extracted = ExtractCallbackDataType<TestStepDef>;
// This should be { method: string; amount: number } but let's see what it actually is

// Let's test each branch individually
type TestValidateAndData = TestStepDef extends { validate: (args: { data: infer ValidateData }) => any; data: infer DataProp }
  ? ValidateData extends unknown ? DataProp : ValidateData
  : never;

type TestValidateOnly = TestStepDef extends { validate: (args: { data: infer ValidateData }) => any }
  ? ValidateData
  : never;

type TestDataOnly = TestStepDef extends { data: infer DataProp }
  ? DataProp
  : never;

// DEBUG: Let's see what happens with the validate condition
type DebugValidate = TestStepDef extends { validate: (args: { data: infer ValidateData }) => any }
  ? ValidateData
  : 'NO_MATCH';

type DebugData = TestStepDef extends { data: infer DataProp }
  ? DataProp
  : 'NO_MATCH';

// Test with a simpler case - just data property
type SimpleStepDef = {
  data: { name: string; age: number };
  beforeExit: (args: any) => void;
  next: string[];
};

type SimpleExtracted = ExtractCallbackDataType<SimpleStepDef>;

// Export types for inspection
export type {
  Extracted,
  TestValidateAndData,
  TestValidateOnly,
  TestDataOnly,
  DebugValidate,
  DebugData,
  SimpleExtracted
};