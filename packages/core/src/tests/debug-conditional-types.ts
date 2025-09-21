/**
 * Debug the exact conditional type logic to see where it's failing
 */

// Test the exact conditional type logic
type TestExtractCallbackDataType<T> =
  T extends { validate: (args: { data: infer ValidateData }) => any; data: infer DataProp }
    ? ValidateData extends unknown ? DataProp : ValidateData
  : T extends { validate: (args: { data: infer ValidateData }) => any }
    ? ValidateData
  : T extends { data: infer DataProp }
    ? DataProp
  : T extends { beforeEnter: (...args: any[]) => infer ReturnType }
    ? ReturnType extends void ? unknown : ReturnType
  : unknown;

// Test with the exact node-saga-wizard pattern
type TestValidateFunction = (args: { data: unknown }) => void;

type TestStepDef = {
  validate: TestValidateFunction;
  data: { orderId: string; customerId: string; totalAmount: number };
  next: ['reserve'];
  beforeExit: any; // This will be any initially
  meta: any;
};

// What does our type extract?
type ExtractedType = TestExtractCallbackDataType<TestStepDef>;

// Let's test each condition step by step
type Test1 = TestStepDef extends { validate: (args: { data: infer ValidateData }) => any; data: infer DataProp }
  ? { matched: true; ValidateData: ValidateData; DataProp: DataProp }
  : { matched: false };

type Test2 = unknown extends unknown ? true : false;

// Test with a simple case
type SimpleTestType = { data: { name: string; age: number } };
type SimpleExtract = TestExtractCallbackDataType<SimpleTestType>;

// Test with validate only
type ValidateOnlyType = { validate: (args: { data: { email: string } }) => void };
type ValidateOnlyExtract = TestExtractCallbackDataType<ValidateOnlyType>;

export type {
  ExtractedType,
  Test1,
  Test2,
  SimpleExtract,
  ValidateOnlyExtract
};