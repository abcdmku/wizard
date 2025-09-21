/**
 * Simple verification that the callback typing solution works
 */

import { defineSteps, step, stepWithValidation } from '../index';

// Test 1: Basic step with data property
const basicSteps = defineSteps({
  payment: step({
    data: { method: 'card', amount: 100 },
    beforeExit: ({ data }) => {
      if (data) {
        // ✅ data is properly typed as { method: string; amount: number }
        const method: string = data.method;
        const amount: number = data.amount;
        console.log(`Processing payment: ${method} for $${amount}`);
      }
    },
    canExit: ({ data }) => {
      if (data) {
        // ✅ data is properly typed as { method: string; amount: number }
        const amount: number = data.amount;
        return amount > 0;
      }
      return false;
    },
    complete: ({ data }) => {
      if (data) {
        // ✅ data is properly typed as { method: string; amount: number }
        const method: string = data.method;
        return method === 'card';
      }
      return false;
    },
    next: ['confirmation'],
  }),

  confirmation: step({
    data: { confirmed: false },
    beforeExit: ({ data }) => {
      if (data) {
        // ✅ data is properly typed as { confirmed: boolean }
        const confirmed: boolean = data.confirmed;
        console.log(`Confirmation status: ${confirmed}`);
      }
    },
    next: [],
  })
});

// Test 2: Step with validation function
const validateUser = ({ data }: { data: { email: string; password: string } }) => {
  if (!data.email.includes('@')) throw new Error('Invalid email');
  if (data.password.length < 8) throw new Error('Password too short');
};

const validationSteps = defineSteps({
  registration: stepWithValidation(validateUser, {
    data: { email: '', password: '' },
    beforeExit: ({ data }) => {
      if (data) {
        // ✅ data is properly typed as { email: string; password: string }
        const email: string = data.email;
        const password: string = data.password;
        console.log(`Registering user: ${email} with password length ${password.length}`);
      }
    },
    canExit: ({ data }) => {
      if (data) {
        // ✅ data is properly typed as { email: string; password: string }
        const email: string = data.email;
        return email.includes('@');
      }
      return false;
    },
    next: ['welcome'],
  }),

  welcome: step({
    data: { message: 'Welcome!' },
    next: [],
  })
});

// Test 3: Complex step with all callbacks
const complexStep = step({
  data: { score: 100, level: 'beginner', active: true },
  beforeEnter: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const score: number = data.score;
      return { ...data, score: score + 10 };
    }
    return { score: 0, level: 'beginner', active: false };
  },
  beforeExit: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const score: number = data.score;
      const level: string = data.level;
      const active: boolean = data.active;
      console.log(`Exit: score=${score}, level=${level}, active=${active}`);
    }
  },
  canEnter: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const active: boolean = data.active;
      return active;
    }
    return false;
  },
  canExit: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const score: number = data.score;
      return score >= 100;
    }
    return false;
  },
  complete: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const score: number = data.score;
      const level: string = data.level;
      return score >= 100 && level !== 'beginner';
    }
    return false;
  },
  weight: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const score: number = data.score;
      return Math.floor(score / 10);
    }
    return 1;
  },
  required: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const active: boolean = data.active;
      return active;
    }
    return false;
  },
  maxRetries: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const score: number = data.score;
      return score < 50 ? 5 : 3;
    }
    return 1;
  },
  retryDelay: ({ data }) => {
    if (data) {
      // ✅ data is properly typed
      const score: number = data.score;
      return score * 10;
    }
    return 1000;
  },
  next: [],
});

export const SOLUTION_VERIFICATION_COMPLETE = true;
export { basicSteps, validationSteps, complexStep };