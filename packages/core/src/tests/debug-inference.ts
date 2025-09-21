/**
 * Debug type inference step by step
 */

import { defineSteps, createWizard } from '../index';
import type { InferStepData, DataMapFromDefs } from '../types';

// Simple step definition
const debugSteps = defineSteps({
  step1: {
    data: { name: 'test' }, // Should infer { name: string }
    next: ['step2'],
  },
  step2: {
    data: { count: 42 }, // Should infer { count: number }
    next: [],
  },
});

// Debug the type inference chain
type Step1Def = typeof debugSteps['step1'];
type Step2Def = typeof debugSteps['step2'];

// What does InferStepData return for each?
type Step1Data = InferStepData<Step1Def>; // Should be { name: string }
type Step2Data = InferStepData<Step2Def>; // Should be { count: number }

// What does DataMapFromDefs return?
type DebugDataMap = DataMapFromDefs<typeof debugSteps>; // Should be { step1: { name: string }, step2: { count: number } }

// Create wizard
const debugWizard = createWizard({
  context: {},
  steps: debugSteps,
});

// What type does getStepData return?
const step1Data = debugWizard.getStepData('step1');
const step2Data = debugWizard.getStepData('step2');

type ActualStep1Type = typeof step1Data; // What is this really?
type ActualStep2Type = typeof step2Data; // What is this really?

// Export types for inspection
export type {
  Step1Data,
  Step2Data,
  DebugDataMap,
  ActualStep1Type,
  ActualStep2Type
};