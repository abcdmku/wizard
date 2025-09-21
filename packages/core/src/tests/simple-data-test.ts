/**
 * Simple test to check if getStepData returns the correct specific type
 */

import { defineSteps, createWizard } from '../index';

// Just one step to test
const oneStepTest = defineSteps({
  onlyStep: {
    data: { message: 'hello world' },
    next: [],
  },
});

const oneStepWizard = createWizard({
  context: {},
  steps: oneStepTest,
});

// Get the data
const onlyStepData = oneStepWizard.getStepData('onlyStep');

// Test: can we access the message property?
function testSingleStep() {
  if (onlyStepData) {
    // This should work if type inference is correct
    const message: string = onlyStepData.message;
    console.log(message);
  }
}

export { testSingleStep };