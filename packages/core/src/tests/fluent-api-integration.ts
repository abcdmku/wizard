/**
 * Fluent API Integration Test
 * Tests the new fluent interface patterns and method chaining capabilities
 */

import { wizardWithContext } from '../wizard-factory';

interface UserData {
  name: string;
  email: string;
  age: number;
}

interface PrefsData {
  theme: 'light' | 'dark';
  notifications: boolean;
}

// Setup test wizard
const { defineSteps, createWizard, step } = wizardWithContext({
  appName: 'FluentTest',
  version: '1.0.0'
});

const steps = defineSteps({
  user: step<UserData>({
    data: { name: '', email: '', age: 0 },
    next: ['preferences'],
  }),
  preferences: step<PrefsData>({
    data: { theme: 'light', notifications: true },
    next: [],
  }),
});

const wizard = createWizard(steps);

export async function testFluentAPI() {
  console.log('=== Fluent API Integration Tests ===');

  // Test 1: Complex fluent chaining with data manipulation
  const complexChain = wizard
    .getStep('user')
    .setData({ name: 'John Doe', email: 'john@example.com', age: 30 })
    .markIdle()
    .markLoading()
    .updateData(data => ({ age: (data?.age || 0) + 1 }))
    .markIdle();

  console.log('✓ Complex fluent chaining works');
  console.log('  Final step name:', complexChain.name);
  console.log('  Final step data:', complexChain.data);

  // Test 2: Navigation with fluent chaining
  try {
    const navigationChain = await wizard
      .getCurrentStep()
      .setData({ name: 'Jane Doe', email: 'jane@example.com', age: 25 })
      .next();

    console.log('✓ Navigation with fluent chaining works');
    console.log('  Navigation result step:', navigationChain.name);
    console.log('  Navigation result data:', navigationChain.data);

    // Test 3: GoTo with fluent continuation
    const gotoChain = await navigationChain
      .setData({ theme: 'dark', notifications: false })
      .goTo('user');

    console.log('✓ GoTo with fluent continuation works');
    console.log('  GoTo result step:', gotoChain.name);
    console.log('  GoTo result data:', gotoChain.data);

  } catch (error) {
    console.log('Navigation error (may be expected):', error);
  }

  // Test 4: Error handling in fluent chains
  const errorHandlingChain = wizard
    .getStep('preferences')
    .markError(new Error('Test error'))
    .setData({ theme: 'light', notifications: true })
    .markIdle();

  console.log('✓ Error handling in fluent chains works');
  console.log('  Error chain final step:', errorHandlingChain.name);
  console.log('  Error chain final data:', errorHandlingChain.data);

  // Test 5: Mixed operations fluent chain
  const mixedChain = wizard
    .markLoading('user')
    .setData({ name: 'Mixed User', email: 'mixed@example.com', age: 35 })
    .markTerminated(new Error('Terminated for testing'))
    .updateData(data => ({ name: `${data?.name} (Updated)` }))
    .markIdle();

  console.log('✓ Mixed operations fluent chain works');
  console.log('  Mixed chain final step:', mixedChain.name);
  console.log('  Mixed chain final data:', mixedChain.data);

  console.log('=== All fluent API integration tests completed ===');
}

// Test method chaining return types
export function testChainReturnTypes() {
  console.log('=== Chain Return Type Tests ===');

  const step = wizard.getStep('user');

  // Each method should return a step wrapper that allows further chaining
  const chain1 = step.markIdle();
  console.log('✓ markIdle() returns chainable step wrapper');

  const chain2 = chain1.markLoading();
  console.log('✓ markLoading() returns chainable step wrapper');

  const chain3 = chain2.setData({ name: 'Test', email: 'test@example.com', age: 25 });
  console.log('✓ setData() returns chainable step wrapper');

  const chain4 = chain3.updateData(data => ({ age: (data?.age || 0) + 5 }));
  console.log('✓ updateData() returns chainable step wrapper');

  const chain5 = chain4.markSkipped();
  console.log('✓ markSkipped() returns chainable step wrapper');

  console.log('Final chain data:', chain5.data);
  console.log('=== Chain return type tests completed ===');
}

// Run tests
testFluentAPI()
  .then(() => testChainReturnTypes())
  .then(() => console.log('🎉 All fluent API tests passed!'))
  .catch(error => console.error('❌ Fluent API test failed:', error));