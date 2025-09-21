/**
 * Minimal test to verify callback argument typing works
 */

import { defineSteps } from '../index';

// Test: Basic step with data property - this should work now
const basicTest = defineSteps({
  payment: {
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }) => {
      // HOVER TEST: data should be typed as { method: string; amount: number }
      // NOT as 'any' or 'unknown'
      if (data) {
        const method: string = data.method;
        const amount: number = data.amount;
        console.log(`Method: ${method}, Amount: ${amount}`);
      }
    },
    canExit: ({ data }) => {
      // HOVER TEST: data should be typed properly
      if (data) {
        const amount: number = data.amount;
        return amount > 0;
      }
      return false;
    },
    complete: ({ data }) => {
      // HOVER TEST: data should be typed properly
      if (data) {
        const method: string = data.method;
        return method === 'card';
      }
      return false;
    },
    next: ['confirmation']
  },

  confirmation: {
    data: { confirmed: false, timestamp: new Date() },
    beforeExit: ({ data }) => {
      // HOVER TEST: data should be typed as { confirmed: boolean; timestamp: Date }
      if (data) {
        const confirmed: boolean = data.confirmed;
        const timestamp: Date = data.timestamp;
        console.log(`Confirmed: ${confirmed} at ${timestamp}`);
      }
    },
    next: []
  }
});

// Test: Step with validation
const validationTest = defineSteps({
  user: {
    validate: ({ data }: { data: { email: string; password: string } }) => {
      if (!data.email.includes('@')) throw new Error('Invalid email');
    },
    data: { email: '', password: '' },
    beforeExit: ({ data }) => {
      // HOVER TEST: data should be typed as { email: string; password: string }
      if (data) {
        const email: string = data.email;
        const password: string = data.password;
        console.log(`User: ${email}, Password length: ${password.length}`);
      }
    },
    next: []
  }
});

export { basicTest, validationTest };