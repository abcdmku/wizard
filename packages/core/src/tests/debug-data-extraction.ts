/**
 * Debug Data Type Extraction
 */

import { wizardWithContext } from '../wizard-factory';

// Test the direct extraction type
type DirectExtractDataType<T> =
  T extends { validate: (args: { data: infer D }) => any }
    ? D
    : T extends { data: infer D }
      ? D
      : unknown;

// Test with step helper function
const { step } = wizardWithContext({ test: true });

const stepResult = step({
  data: { value: 42 },
  next: []
});

// What does DirectExtractDataType extract from this?
type ExtractedFromStepResult = DirectExtractDataType<typeof stepResult>;

// This should be { value: number }
const testExtraction: ExtractedFromStepResult = { value: 42 };

// Let's also test with a literal object
type LiteralStepDef = {
  data: { value: number };
  next: string[];
};

type ExtractedFromLiteral = DirectExtractDataType<LiteralStepDef>;
const testLiteral: ExtractedFromLiteral = { value: 42 };

// Test the step object structure
console.log('stepResult:', stepResult);
console.log('stepResult.data:', stepResult.data);
console.log('typeof stepResult.data:', typeof stepResult.data);

// Test the actual data extraction
console.log('testExtraction:', testExtraction);
console.log('testLiteral:', testLiteral);

export type ExtractionTest = {
  StepResultType: typeof stepResult;
  ExtractedFromStepResult: ExtractedFromStepResult;
  ExtractedFromLiteral: ExtractedFromLiteral;
};