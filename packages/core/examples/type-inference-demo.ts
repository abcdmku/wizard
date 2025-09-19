/**
 * Demo file to verify type inference is working correctly
 * This should compile without errors and have full type safety
 */

import { createWizard } from '../src';
import { z } from 'zod';

// Example 1: Fully inferred wizard with Zod validation
const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  age: z.number().min(18),
});

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  zipCode: z.string().regex(/^\d{5}$/),
  country: z.string(),
});

const wizard = createWizard({
  initialStep: 'user',
  initialContext: {
    sessionId: crypto.randomUUID(),
    startTime: Date.now(),
  },
  steps: {
    user: {
      next: ['address'],
      validate: userSchema.parse,
    },
    address: {
      next: ['review'],
      validate: addressSchema.parse,
    },
    review: {
      next: ['complete'],
      load: async () => {
        // Simulate loading review data
        return {
          summary: 'Review your information',
          canEdit: true,
        };
      },
    },
    complete: {
      next: [],
      validate: (data): data is { confirmed: boolean } => {
        return typeof data === 'object' && data !== null && 'confirmed' in data;
      },
    },
  },
});

// Test type inference - TypeScript should know the exact types
function testTypeInference() {
  // Setting step data should be type-safe
  wizard.setStepData('user', {
    name: 'John Doe',
    email: 'john@example.com',
    age: 25,
  });

  wizard.setStepData('address', {
    street: '123 Main St',
    city: 'New York',
    zipCode: '12345',
    country: 'USA',
  });

  // Getting step data returns the correct type
  const userData = wizard.getStepData('user');
  if (userData) {
    console.log(userData.name); // TypeScript knows this exists
    console.log(userData.email); // TypeScript knows this exists
    console.log(userData.age); // TypeScript knows this exists
  }

  const addressData = wizard.getStepData('address');
  if (addressData) {
    console.log(addressData.street); // TypeScript knows this exists
    console.log(addressData.zipCode); // TypeScript knows this exists
  }

  const reviewData = wizard.getStepData('review');
  if (reviewData) {
    console.log(reviewData.summary); // TypeScript knows this exists
    console.log(reviewData.canEdit); // TypeScript knows this exists
  }

  // Context is inferred
  const context = wizard.getContext();
  console.log(context.sessionId); // TypeScript knows this exists
  console.log(context.startTime); // TypeScript knows this exists

  // Step navigation
  wizard.next({ data: userData });
  wizard.goTo('review');
  wizard.back();

  // Helpers work correctly
  const progress = wizard.helpers.progress();
  console.log(`Progress: ${progress.percent}%`);

  const completedSteps = wizard.helpers.completedSteps();
  console.log('Completed:', completedSteps);

  const currentStep = wizard.store.state.step;
  console.log('Current step:', currentStep);
}

// Example 2: Mixed validation patterns
const mixedWizard = createWizard({
  initialStep: 'start',
  steps: {
    start: {
      next: ['zodValidation'],
      // No validation - accepts any data
    },
    zodValidation: {
      next: ['typeGuard'],
      validate: z.object({
        zodField: z.string(),
        zodNumber: z.number(),
      }).parse,
    },
    typeGuard: {
      next: ['assertion'],
      validate: (data): data is { guardedField: boolean } => {
        return typeof data === 'object' &&
               data !== null &&
               'guardedField' in data &&
               typeof (data as any).guardedField === 'boolean';
      },
    },
    assertion: {
      next: ['loadData'],
      validate: (data): asserts data is { assertedField: string } => {
        if (!data || typeof data !== 'object' || !('assertedField' in data)) {
          throw new Error('Missing assertedField');
        }
        if (typeof (data as any).assertedField !== 'string') {
          throw new Error('assertedField must be a string');
        }
      },
    },
    loadData: {
      next: [],
      load: () => ({
        loadedData: 'This was loaded',
        timestamp: Date.now(),
      }),
    },
  },
});

// Test mixed validation patterns
function testMixedValidation() {
  // Each step has correctly inferred types
  mixedWizard.setStepData('start', { anything: 'goes' });

  mixedWizard.setStepData('zodValidation', {
    zodField: 'test',
    zodNumber: 42,
  });

  mixedWizard.setStepData('typeGuard', {
    guardedField: true,
  });

  mixedWizard.setStepData('assertion', {
    assertedField: 'asserted',
  });

  const loadData = mixedWizard.getStepData('loadData');
  if (loadData) {
    console.log(loadData.loadedData); // TypeScript knows this exists
    console.log(loadData.timestamp); // TypeScript knows this exists
  }
}

// Run the tests
testTypeInference();
testMixedValidation();

console.log('✅ Type inference is working correctly!');

export { wizard, mixedWizard };