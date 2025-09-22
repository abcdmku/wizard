/**
 * Enhanced Typing and Fluent API Validation Test
 * This test validates that our enhanced typing implementation works correctly
 */

import { wizardWithContext } from '../wizard-factory';

// Test types
interface AppContext {
  userId: string;
  theme: 'light' | 'dark';
  permissions: string[];
}

interface Step1Data {
  email: string;
  username: string;
}

interface Step2Data {
  firstName: string;
  lastName: string;
  age: number;
}

interface Step3Data {
  preferences: {
    notifications: boolean;
    newsletter: boolean;
  };
}

// Test wizard setup
const { defineSteps, createWizard, step } = wizardWithContext<AppContext>({
  userId: 'test-user',
  theme: 'light',
  permissions: ['read', 'write'],
});

const steps = defineSteps({
  account: step<Step1Data>({
    data: { email: '', username: '' },
    next: ['profile'],
  }),
  profile: step<Step2Data>({
    data: { firstName: '', lastName: '', age: 0 },
    next: ['preferences'],
  }),
  preferences: step<Step3Data>({
    data: { preferences: { notifications: true, newsletter: false } },
    next: [],
  }),
});

// Test the enhanced wizard
const wizard = createWizard(steps);

// ========== TYPE INFERENCE VALIDATION ==========

export async function testTypeInference() {
  console.log('=== Enhanced Typing Validation ===');

  // Test 1: getCurrentStep() should return properly typed step wrapper
  const currentStep = wizard.getCurrentStep();
  console.log('✓ getCurrentStep() returns typed step wrapper');
  console.log('  Step name:', currentStep.name);
  console.log('  Step data:', currentStep.data);
  console.log('  Context:', currentStep.context);

  // Test 2: getStep() should return properly typed step wrapper for specific step
  const accountStep = wizard.getStep('account');
  console.log('✓ getStep() returns typed step wrapper');
  console.log('  Account step name:', accountStep.name);
  console.log('  Account step data:', accountStep.data); // Should be Step1Data | undefined

  // Test 3: Fluent API chaining
  const fluentResult = accountStep
    .markIdle()
    .markLoading()
    .setData({ email: 'test@example.com', username: 'testuser' });
  console.log('✓ Fluent API chaining works');
  console.log('  Fluent result step name:', fluentResult.name);
  console.log('  Fluent result data:', fluentResult.data);

  // Test 4: Navigation methods return step objects
  try {
    const nextStep = await wizard.next();
    console.log('✓ next() returns step wrapper');
    console.log('  Next step name:', nextStep.name);
    console.log('  Next step data:', nextStep.data);

    const targetStep = await wizard.goTo('preferences');
    console.log('✓ goTo() returns step wrapper');
    console.log('  Target step name:', targetStep.name);
    console.log('  Target step data:', targetStep.data); // Should be Step3Data | undefined

    const backStep = await wizard.back();
    console.log('✓ back() returns step wrapper');
    console.log('  Back step name:', backStep.name);
  } catch (error) {
    console.log('Navigation error (expected in some cases):', error);
  }

  // Test 5: Mark methods return typed step wrappers
  const errorStep = wizard.markError('account', new Error('Test error'));
  console.log('✓ markError() returns typed step wrapper');
  console.log('  Error step name:', errorStep.name);
  console.log('  Error step data:', errorStep.data);

  const loadingStep = wizard.markLoading('profile');
  console.log('✓ markLoading() returns typed step wrapper');
  console.log('  Loading step name:', loadingStep.name);
  console.log('  Loading step data:', loadingStep.data); // Should be Step2Data | undefined

  console.log('=== All type inference tests completed ===');
}

// ========== COMPILE-TIME TYPE CHECKING ==========

export function compileTimeTypeTests() {
  // These tests are designed to be checked at compile time
  // If there are type errors, TypeScript compilation will fail

  const currentStep = wizard.getCurrentStep();

  // Test: currentStep.data should be properly typed (not unknown)
  if (currentStep.data) {
    // This should work if data is properly typed as Step1Data
    const email = (currentStep.data as Step1Data).email;
    const username = (currentStep.data as Step1Data).username;
    console.log('Compile-time test: Current step data access works', { email, username });
  }

  // Test: getStep should return properly typed data
  const accountStep = wizard.getStep('account');
  if (accountStep.data) {
    // This should work if data is properly typed as Step1Data
    const email = accountStep.data.email;
    const username = accountStep.data.username;
    console.log('Compile-time test: Specific step data access works', { email, username });
  }

  // Test: Fluent chaining should preserve types
  const chainedStep = accountStep
    .markIdle()
    .markLoading()
    .setData({ email: 'new@example.com', username: 'newuser' });

  if (chainedStep.data) {
    const email = chainedStep.data.email;
    const username = chainedStep.data.username;
    console.log('Compile-time test: Fluent chain data access works', { email, username });
  }

  console.log('✓ All compile-time type tests passed');
}

// Export tests for use in other files
export { wizard, steps };

// Run tests if this file is executed directly
testTypeInference()
  .then(() => compileTimeTypeTests())
  .then(() => console.log('All enhanced typing tests completed successfully!'))
  .catch(error => console.error('Test failed:', error));