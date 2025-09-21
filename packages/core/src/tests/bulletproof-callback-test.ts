/**
 * BULLETPROOF TEST: Testing the enhanced defineSteps with proper callback typing
 */

import { defineSteps } from '../index';

// Test 1: Basic data inference with callbacks
const bulletproofSteps = defineSteps({
  payment: {
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data, ctx, updateContext }) => {
      // These should now be properly typed!
      // data: { method: string; amount: number }
      // ctx: Readonly<unknown>
      // updateContext: (fn: (ctx: unknown) => void) => void

      const method: string = data.method; // Should work!
      const amount: number = data.amount; // Should work!

      updateContext((context) => {
        // context: unknown
        console.log('Context updated');
      });

      console.log(`Payment: ${method} for $${amount}`);
    },
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false },
    beforeExit: ({ data }) => {
      // data: { confirmed: boolean }
      const confirmed: boolean = data.confirmed; // Should work!
      console.log(`Confirmed: ${confirmed}`);
    },
    next: [],
  },
});

// Test 2: Validate function inference
const validateSteps = defineSteps({
  login: {
    validate: ({ data }: { data: { email: string; password: string } }) => {
      if (!data.email || !data.password) throw new Error('Invalid');
    },
    beforeExit: ({ data }) => {
      // data should be inferred from validate function
      const email: string = data.email; // Should work!
      const password: string = data.password; // Should work!
      console.log(`Login: ${email}`);
    },
    next: [],
  },
});

// Test 3: Mixed inference patterns
const mixedSteps = defineSteps({
  init: {
    data: { userId: '123', timestamp: Date.now() },
    beforeEnter: ({ data }) => {
      // data: { userId: string; timestamp: number }
      const userId: string = data.userId; // Should work!
      const timestamp: number = data.timestamp; // Should work!
      console.log(`Init: ${userId} at ${timestamp}`);
    },
    next: ['process'],
  },
  process: {
    validate: ({ data }: { data: { status: 'pending' | 'complete' } }) => {
      // validation
    },
    beforeExit: ({ data }) => {
      // data: { status: 'pending' | 'complete' }
      const status: 'pending' | 'complete' = data.status; // Should work!
      console.log(`Status: ${status}`);
    },
    next: [],
  },
});

export const BULLETPROOF_CALLBACK_TYPING_WORKS = true;
export { bulletproofSteps, validateSteps, mixedSteps };