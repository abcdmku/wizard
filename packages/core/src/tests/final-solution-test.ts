/**
 * FINAL SOLUTION TEST
 * This test verifies that callback arguments are properly typed in the IDE
 */

import { defineSteps, createWizard } from '../index';

// Test 1: Data property inference
const dataOnlySteps = defineSteps({
  step1: {
    data: { name: 'John', age: 30, isActive: true },
    beforeExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { name: string; age: number; isActive: boolean }
      const name: string = data.name;
      const age: number = data.age;
      const isActive: boolean = data.isActive;
      console.log(name, age, isActive);
    },
    canExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { name: string; age: number; isActive: boolean }
      const age: number = data.age;
      return age >= 18;
    },
    complete: ({ data }) => {
      // ✅ HOVER TEST: data should show { name: string; age: number; isActive: boolean }
      const name: string = data.name;
      return name.length > 0;
    },
    next: ['step2'],
  },
  step2: {
    data: { score: 100, level: 'beginner' },
    beforeExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { score: number; level: string }
      const score: number = data.score;
      const level: string = data.level;
      console.log(score, level);
    },
    next: [],
  }
});

// Test 2: Validate function with specific types
const validateSpecificSteps = defineSteps({
  step1: {
    validate: ({ data }: { data: { email: string; password: string } }) => {
      if (!data.email.includes('@')) throw new Error('Invalid email');
    },
    data: { email: '', password: '' },
    beforeExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { email: string; password: string }
      const email: string = data.email;
      const password: string = data.password;
      console.log(email, password);
    },
    canExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { email: string; password: string }
      const email: string = data.email;
      return email.length > 0;
    },
    next: [],
  }
});

// Test 3: Validate with unknown (node-saga-wizard pattern)
const validateUnknownSteps = defineSteps({
  init: {
    validate: ({ data }: { data: unknown }) => {
      console.log('Validating:', data);
    },
    data: { orderId: '', customerId: '', totalAmount: 0 },
    beforeExit: ({ data, updateContext }) => {
      // ✅ HOVER TEST: data should show { orderId: string; customerId: string; totalAmount: number }
      // NOT any!
      const orderId: string = data.orderId;
      const customerId: string = data.customerId;
      const totalAmount: number = data.totalAmount;

      updateContext(() => {
        console.log(`Order: ${orderId}, Customer: ${customerId}, Amount: ${totalAmount}`);
      });
    },
    canExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { orderId: string; customerId: string; totalAmount: number }
      const totalAmount: number = data.totalAmount;
      return totalAmount > 0;
    },
    next: [],
  }
});

// Test 4: All callback properties
const allCallbacksSteps = defineSteps({
  step1: {
    data: { value: 42, enabled: true },
    beforeExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const value: number = data.value;
      const enabled: boolean = data.enabled;
      console.log(value, enabled);
    },
    beforeEnter: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const value: number = data.value;
      return { value: value + 1, enabled: true };
    },
    canEnter: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const enabled: boolean = data.enabled;
      return enabled;
    },
    canExit: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const value: number = data.value;
      return value > 0;
    },
    complete: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const value: number = data.value;
      return value >= 42;
    },
    weight: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const value: number = data.value;
      return value / 10;
    },
    required: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const enabled: boolean = data.enabled;
      return enabled;
    },
    maxRetries: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const value: number = data.value;
      return value > 50 ? 5 : 3;
    },
    retryDelay: ({ data }) => {
      // ✅ HOVER TEST: data should show { value: number; enabled: boolean }
      const value: number = data.value;
      return value * 100;
    },
    next: [],
  }
});

// Test 5: Verify getStepData still works
const wizard = createWizard({
  context: {},
  steps: dataOnlySteps,
});

const step1Data = wizard.getStepData('step1');
if (step1Data) {
  // ✅ HOVER TEST: step1Data should show { name: string; age: number; isActive: boolean }
  const name: string = step1Data.name;
  const age: number = step1Data.age;
  const isActive: boolean = step1Data.isActive;
  console.log('getStepData works:', name, age, isActive);
}

export {
  dataOnlySteps,
  validateSpecificSteps,
  validateUnknownSteps,
  allCallbacksSteps,
  wizard,
};