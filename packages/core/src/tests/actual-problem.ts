/**
 * Demonstrate the actual problem with real compilation errors
 */

import { defineSteps, createWizard } from '../index';

// Using defineSteps (the problematic case)
const stepsWithDefine = defineSteps({
  payment: {
    data: { method: 'card', amount: 100 },
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false },
    next: [],
  },
});

const wizardWithDefine = createWizard({
  context: {},
  steps: stepsWithDefine,
});

// Without defineSteps (direct object)
const stepsWithoutDefine = {
  payment: {
    data: { method: 'card', amount: 100 },
    next: ['confirmation'],
  },
  confirmation: {
    data: { confirmed: false },
    next: [],
  },
};

const wizardWithoutDefine = createWizard({
  context: {},
  steps: stepsWithoutDefine,
});

// Test both approaches
function testWithDefine() {
  const paymentData = wizardWithDefine.getStepData('payment');
  if (paymentData) {
    // This should fail if getStepData returns union type
    const method: string = paymentData.method; // Does this work?
    const amount: number = paymentData.amount; // Does this work?
    console.log(method, amount);
  }
}

function testWithoutDefine() {
  const paymentData = wizardWithoutDefine.getStepData('payment');
  if (paymentData) {
    // This should work if direct object preserves types better
    const method: string = paymentData.method; // Does this work?
    const amount: number = paymentData.amount; // Does this work?
    console.log(method, amount);
  }
}

export { testWithDefine, testWithoutDefine };