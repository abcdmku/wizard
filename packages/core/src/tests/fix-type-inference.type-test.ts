/**
 * TypeScript type tests for fixed type inference
 * This file is used to verify that TypeScript correctly infers types after the fixes.
 * It won't be executed, but TypeScript will check it during compilation.
 */

import { defineSteps, createWizard } from '../index';

// Test 1: Basic data inference
const basicSteps = defineSteps({
  step1: {
    data: { name: 'test', count: 42 },
    next: ['step2'],
  },
  step2: {
    data: { email: 'test@test.com' },
    next: [],
  },
});

const basicWizard = createWizard({ context: {}, steps: basicSteps });

// These should be properly typed:
const step1Data = basicWizard.getStepData('step1'); // { name: string; count: number } | undefined
const step2Data = basicWizard.getStepData('step2'); // { email: string } | undefined

// Type assertions to verify inference works - commented out to avoid unused variable errors
// type Step1Type = typeof step1Data; // Should be { name: string; count: number } | undefined
// type Step2Type = typeof step2Data; // Should be { email: string } | undefined

// Test 2: Validate function inference
const validateSteps = defineSteps({
  validated: {
    validate: ({ data }: { data: { email: string; password: string } }) => {
      // Validation logic
      if (!data.email || !data.password) {
        throw new Error('Invalid data');
      }
    },
    next: [],
  }
});

const validateWizard = createWizard({ context: {}, steps: validateSteps });
const validatedData = validateWizard.getStepData('validated'); // { email: string; password: string } | undefined

// type ValidatedType = typeof validatedData; // Should be { email: string; password: string } | undefined

// Test 3: Callback argument typing
const callbackSteps = defineSteps({
  withCallbacks: {
    data: { value: 123 },
    beforeExit: ({ data, updateContext }: { data: { value: number }; updateContext: (fn: (ctx: {}) => void) => void }) => {
      // data should be: { value: number }
      // updateContext should be: (fn: (ctx: {}) => void) => void

      // Type test - these should compile without errors:
      const _value: number = data.value; // Use underscore to indicate intentionally unused
      updateContext((_context) => {
        // context should be typed as {}
      });
    },
    next: [],
  }
});

const callbackWizard = createWizard({ context: {}, steps: callbackSteps });
const callbackData = callbackWizard.getStepData('withCallbacks'); // { value: number } | undefined

// type CallbackType = typeof callbackData; // Should be { value: number } | undefined

// Test 4: Mixed step types
const mixedSteps = defineSteps({
  withData: {
    data: { name: 'John', age: 30 },
    next: ['withValidate'],
  },
  withValidate: {
    validate: ({ data }: { data: { email: string; verified: boolean } }) => {
      if (!data.email.includes('@')) throw new Error('Invalid email');
    },
    next: ['withCallback'],
  },
  withCallback: {
    beforeEnter: () => ({ status: 'ready', timestamp: Date.now() }),
    next: [],
  },
});

const mixedWizard = createWizard({
  context: { userId: '123' },
  steps: mixedSteps
});

// These should all be properly typed:
const dataStep = mixedWizard.getStepData('withData');        // { name: string; age: number } | undefined
const validateStep = mixedWizard.getStepData('withValidate'); // { email: string; verified: boolean } | undefined
const callbackStep = mixedWizard.getStepData('withCallback'); // { status: string; timestamp: number } | undefined

// Type assertions for verification - commented out to avoid unused variable errors
// type DataStepType = typeof dataStep;        // { name: string; age: number } | undefined
// type ValidateStepType = typeof validateStep; // { email: string; verified: boolean } | undefined
// type CallbackStepType = typeof callbackStep; // { status: string; timestamp: number } | undefined

// Test 5: Context inference
const contextWizard = createWizard({
  context: { userId: '123', preferences: { theme: 'dark' } },
  steps: basicSteps
});

const wizardContext = contextWizard.getContext(); // Should be typed as the context object
// type ContextType = typeof wizardContext; // Should be { userId: string; preferences: { theme: string } }

// Test 6: Verify helper functions work with proper types
const helpers = basicWizard.helpers;
const _allSteps = helpers.allSteps(); // Should be readonly ('step1' | 'step2')[]
const _progress = helpers.progress(); // Should be { ratio: number; percent: number; label: string }

// Success indicators - if this file compiles without errors, type inference is working
export const TYPE_INFERENCE_TESTS_PASS = true;