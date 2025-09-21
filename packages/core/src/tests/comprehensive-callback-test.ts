/**
 * Comprehensive test to ensure ALL callback properties get proper type inference
 */

import { defineSteps } from '../index';

// Test case with ALL callback properties using data inference
const comprehensiveSteps = defineSteps({
  step1: {
    data: { name: 'John', age: 30, isActive: true },
    beforeExit: ({ data }) => {
      // Test beforeExit typing
      const name: string = data.name;
      const age: number = data.age;
      const isActive: boolean = data.isActive;
      console.log(name, age, isActive);
    },
    beforeEnter: ({ data }) => {
      // Test beforeEnter typing
      const name: string = data.name;
      const age: number = data.age;
      return { name, age: age + 1, isActive: true };
    },
    canEnter: ({ data }) => {
      // Test canEnter typing
      const name: string = data.name;
      const age: number = data.age;
      return name.length > 0 && age > 0;
    },
    canExit: ({ data }) => {
      // Test canExit typing
      const name: string = data.name;
      const age: number = data.age;
      const isActive: boolean = data.isActive;
      return name.length > 0 && age > 18 && isActive;
    },
    complete: ({ data }) => {
      // Test complete typing
      const name: string = data.name;
      const age: number = data.age;
      return name.length > 0 && age >= 18;
    },
    weight: ({ data }) => {
      // Test weight typing
      const age: number = data.age;
      return age > 65 ? 0.5 : 1.0;
    },
    required: ({ data }) => {
      // Test required typing
      const isActive: boolean = data.isActive;
      return isActive;
    },
    maxRetries: ({ data }) => {
      // Test maxRetries typing
      const age: number = data.age;
      return age > 65 ? 5 : 3;
    },
    retryDelay: ({ data }) => {
      // Test retryDelay typing
      const age: number = data.age;
      return age > 65 ? 2000 : 1000;
    },
    next: ['step2'],
  },
  step2: {
    validate: ({ data }: { data: { score: number; level: string } }) => {
      if (data.score < 0 || !data.level) throw new Error('Invalid data');
    },
    data: { score: 100, level: 'beginner' },
    beforeExit: ({ data }) => {
      // Test beforeExit with validate inference
      const score: number = data.score;
      const level: string = data.level;
      console.log(score, level);
    },
    canEnter: ({ data }) => {
      // Test canEnter with validate inference
      const score: number = data.score;
      return score >= 0;
    },
    canExit: ({ data }) => {
      // Test canExit with validate inference
      const score: number = data.score;
      const level: string = data.level;
      return score > 50 && level !== 'beginner';
    },
    complete: ({ data }) => {
      // Test complete with validate inference
      const score: number = data.score;
      return score >= 100;
    },
    weight: ({ data }) => {
      // Test weight with validate inference
      const score: number = data.score;
      return score > 80 ? 2.0 : 1.0;
    },
    required: ({ data }) => {
      // Test required with validate inference
      const level: string = data.level;
      return level !== 'optional';
    },
    next: [],
  }
});

// Test the actual step types
type StepsType = typeof comprehensiveSteps;
type Step1Type = StepsType['step1'];
type Step2Type = StepsType['step2'];

// Verify all callback types exist and are properly typed
type Step1BeforeExit = Step1Type['beforeExit'];
type Step1CanExit = Step1Type['canExit'];
type Step1Complete = Step1Type['complete'];
type Step1Weight = Step1Type['weight'];
type Step1Required = Step1Type['required'];

type Step2BeforeExit = Step2Type['beforeExit'];
type Step2CanExit = Step2Type['canExit'];
type Step2Complete = Step2Type['complete'];

export {
  comprehensiveSteps,
  type Step1BeforeExit,
  type Step1CanExit,
  type Step1Complete,
  type Step1Weight,
  type Step1Required,
  type Step2BeforeExit,
  type Step2CanExit,
  type Step2Complete
};