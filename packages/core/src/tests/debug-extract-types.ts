/**
 * Debug Step Data Type Extraction
 */

import type { ExtractStepDataType, EnhancedDataMapFromDefs } from '../types';
import { wizardWithContext } from '../wizard-factory';

// Test direct type extraction
type DirectStepDef = {
  data: { value: number };
  next: string[];
};

type ExtractedFromDirect = ExtractStepDataType<{ step1: DirectStepDef }, 'step1'>;
const testDirect: ExtractedFromDirect = { value: 42 }; // This should work

// Test with step helper
const { step } = wizardWithContext({ test: true });

const stepDef = step({
  data: { value: 42 },
  next: []
});

type StepDefType = typeof stepDef;
type ExtractedFromStep = ExtractStepDataType<{ step1: StepDefType }, 'step1'>;

// This test will show us what's actually being extracted
const testFromStep: ExtractedFromStep = { value: 42 }; // Will this work?

// Test the full flow
const steps = {
  step1: stepDef
};

type StepsType = typeof steps;
type FullDataMap = EnhancedDataMapFromDefs<StepsType>;
type Step1Data = FullDataMap['step1'];

const testFullFlow: Step1Data = { value: 42 }; // Will this work?

console.log('Type extraction tests passed at runtime');
console.log('testDirect:', testDirect);
console.log('stepDef:', stepDef);

export type TypeTests = {
  DirectStepDef: DirectStepDef;
  ExtractedFromDirect: ExtractedFromDirect;
  StepDefType: StepDefType;
  ExtractedFromStep: ExtractedFromStep;
  StepsType: StepsType;
  FullDataMap: FullDataMap;
  Step1Data: Step1Data;
};