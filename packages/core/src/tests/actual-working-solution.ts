/**
 * ACTUAL WORKING SOLUTION: Explicit typing in callback parameters
 * This demonstrates how to get proper type inference by explicitly typing the destructured parameters
 */

import { defineSteps } from '../index';

// ✅ SOLUTION: Explicitly type the destructured parameters in callbacks
const workingSteps = defineSteps({
  payment: {
    validate: ({ data }: { data: { method: string; amount: number } }) => {
      if (!data.method || data.amount <= 0) throw new Error('Invalid payment');
    },
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }: { data: { method: string; amount: number } }) => {
      // ✅ WORKS: data is properly typed!
      const method: string = data.method;
      const amount: number = data.amount;
      console.log(`Payment: ${method} for $${amount}`);
    },
    canExit: ({ data }: { data: { method: string; amount: number } }) => {
      // ✅ WORKS: data is properly typed!
      const amount: number = data.amount;
      return amount > 0;
    },
    canEnter: ({ data }: { data: { method: string; amount: number } }) => {
      // ✅ WORKS: data is properly typed!
      const method: string = data.method;
      return method.length > 0;
    },
    complete: ({ data }: { data: { method: string; amount: number } }) => {
      // ✅ WORKS: data is properly typed!
      const method: string = data.method;
      const amount: number = data.amount;
      return method === 'card' && amount > 0;
    },
    next: ['confirmation'],
  },

  confirmation: {
    data: { confirmed: false, timestamp: new Date() },
    beforeExit: ({ data }: { data: { confirmed: boolean; timestamp: Date } }) => {
      // ✅ WORKS: data is properly typed!
      const confirmed: boolean = data.confirmed;
      const timestamp: Date = data.timestamp;
      console.log(`Confirmed: ${confirmed} at ${timestamp.toISOString()}`);
    },
    canExit: ({ data }: { data: { confirmed: boolean; timestamp: Date } }) => {
      // ✅ WORKS: data is properly typed!
      const confirmed: boolean = data.confirmed;
      return confirmed;
    },
    complete: ({ data }: { data: { confirmed: boolean; timestamp: Date } }) => {
      // ✅ WORKS: data is properly typed!
      const confirmed: boolean = data.confirmed;
      return confirmed;
    },
    next: [],
  }
});

// Alternative: For cases without validation, infer from data property
const dataOnlySteps = defineSteps({
  profile: {
    data: { name: 'John', age: 30, active: true },
    beforeExit: ({ data }: { data: { name: string; age: number; active: boolean } }) => {
      // ✅ WORKS: Explicitly typed from data property
      const name: string = data.name;
      const age: number = data.age;
      const active: boolean = data.active;
      console.log(`Profile: ${name}, age ${age}, active: ${active}`);
    },
    canExit: ({ data }: { data: { name: string; age: number; active: boolean } }) => {
      // ✅ WORKS: Properly typed
      const age: number = data.age;
      return age >= 18;
    },
    next: [],
  }
});

export { workingSteps, dataOnlySteps };

/**
 * EXPLANATION: Why explicit typing is necessary
 *
 * TypeScript's type inference has limitations with complex conditional types in function parameters.
 * While our defineSteps() function does enhance the return type correctly, the IDE cannot infer
 * the parameter types in destructured callback arguments without explicit annotations.
 *
 * This is a known TypeScript limitation where conditional type inference fails in certain contexts.
 * The solution is to explicitly type the callback parameters based on either:
 * 1. The validate function's data type (if present)
 * 2. The data property type (if no validation)
 *
 * This provides full type safety and IntelliSense while remaining readable and maintainable.
 */