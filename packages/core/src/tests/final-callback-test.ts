/**
 * Final comprehensive test for all callback types in all scenarios
 */

import { defineSteps, createWizard } from '../index';

// Test 1: Data property only
const dataOnlySteps = defineSteps({
  step1: {
    data: { name: 'John', age: 30 },
    beforeExit: ({ data }) => {
      // These should be properly typed
      const name: string = data.name;
      const age: number = data.age;
      console.log(name, age);
    },
    canExit: ({ data }) => {
      const age: number = data.age;
      return age >= 18;
    },
    complete: ({ data }) => {
      const name: string = data.name;
      return name.length > 0;
    },
    next: [],
  }
});

// Test 2: Validate with specific types
const validateSpecificSteps = defineSteps({
  step1: {
    validate: ({ data }: { data: { score: number; level: string } }) => {
      if (data.score < 0) throw new Error('Invalid score');
    },
    data: { score: 100, level: 'beginner' },
    beforeExit: ({ data }) => {
      // Should use validate-inferred types
      const score: number = data.score;
      const level: string = data.level;
      console.log(score, level);
    },
    canExit: ({ data }) => {
      const score: number = data.score;
      return score > 50;
    },
    next: [],
  }
});

// Test 3: Validate with unknown (like node-saga-wizard)
const validateUnknownSteps = defineSteps({
  step1: {
    validate: ({ data }: { data: unknown }) => {
      console.log(data);
    },
    data: { orderId: '', customerId: '', totalAmount: 0 },
    beforeExit: ({ data }) => {
      // Should fall back to data property types
      const orderId: string = data.orderId;
      const customerId: string = data.customerId;
      const totalAmount: number = data.totalAmount;
      console.log(orderId, customerId, totalAmount);
    },
    canExit: ({ data }) => {
      const totalAmount: number = data.totalAmount;
      return totalAmount > 0;
    },
    next: [],
  }
});

// Test 4: beforeEnter return type inference
const beforeEnterSteps = defineSteps({
  step1: {
    beforeEnter: () => ({ userId: '123', isActive: true }),
    beforeExit: ({ data }) => {
      // Should infer from beforeEnter return type
      const userId: string = data.userId;
      const isActive: boolean = data.isActive;
      console.log(userId, isActive);
    },
    next: [],
  }
});

// Test 5: All callbacks with different property functions
const allCallbacksSteps = defineSteps({
  step1: {
    data: { value: 42, enabled: true },
    beforeExit: ({ data }) => {
      const value: number = data.value;
      const enabled: boolean = data.enabled;
      console.log(value, enabled);
    },
    canEnter: ({ data }) => {
      const enabled: boolean = data.enabled;
      return enabled;
    },
    canExit: ({ data }) => {
      const value: number = data.value;
      return value > 0;
    },
    complete: ({ data }) => {
      const value: number = data.value;
      return value >= 42;
    },
    weight: ({ data }) => {
      const value: number = data.value;
      return value / 10;
    },
    required: ({ data }) => {
      const enabled: boolean = data.enabled;
      return enabled;
    },
    maxRetries: ({ data }) => {
      const value: number = data.value;
      return value > 50 ? 5 : 3;
    },
    retryDelay: ({ data }) => {
      const value: number = data.value;
      return value * 100;
    },
    next: [],
  }
});

// Test creating wizards to verify everything works
const wizard1 = createWizard({
  context: {},
  steps: dataOnlySteps,
});

const wizard2 = createWizard({
  context: {},
  steps: validateSpecificSteps,
});

const wizard3 = createWizard({
  context: {},
  steps: validateUnknownSteps,
});

const wizard4 = createWizard({
  context: {},
  steps: beforeEnterSteps,
});

const wizard5 = createWizard({
  context: {},
  steps: allCallbacksSteps,
});

// Verify getStepData returns properly typed data
const step1Data = wizard1.getStepData('step1');
if (step1Data) {
  const name: string = step1Data.name;
  const age: number = step1Data.age;
  console.log('getStepData works:', name, age);
}

export {
  dataOnlySteps,
  validateSpecificSteps,
  validateUnknownSteps,
  beforeEnterSteps,
  allCallbacksSteps,
  wizard1,
  wizard2,
  wizard3,
  wizard4,
  wizard5,
};