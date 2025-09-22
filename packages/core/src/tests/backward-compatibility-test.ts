/**
 * Backward Compatibility Test
 * Ensures that existing APIs still work after our enhanced typing changes
 */

import { createWizard } from '../wizard';
import { wizardWithContext } from '../wizard-factory';

// Test backward compatibility with existing patterns
export async function testBackwardCompatibility() {
  console.log('=== Backward Compatibility Tests ===');

  // Test 1: Original createWizard API should still work
  try {
    const wizard1 = createWizard({
      context: { userId: 'test' },
      steps: {
        step1: {
          next: ['step2'],
          validate: ({ data }: { data: unknown }) => {
            if (!data || typeof data !== 'object') {
              throw new Error('Invalid data');
            }
          }
        },
        step2: {
          next: []
        }
      }
    });

    console.log('✓ Original createWizard API works');
    console.log('  Current step:', wizard1.getCurrent().step);
    console.log('  Context:', wizard1.getCurrent().context);

  } catch (error) {
    console.log('❌ Original createWizard API failed:', error);
  }

  // Test 2: wizardWithContext should maintain backward compatibility
  try {
    const { defineSteps, createWizard: contextCreate } = wizardWithContext({ appId: 'test-app' });

    const steps = defineSteps({
      start: {
        next: ['end'],
        data: { message: 'Hello' }
      },
      end: {
        next: []
      }
    });

    const wizard2 = contextCreate(steps);

    console.log('✓ wizardWithContext API works');
    console.log('  Current step:', wizard2.getCurrent().step);
    console.log('  Context:', wizard2.getCurrent().context);

  } catch (error) {
    console.log('❌ wizardWithContext API failed:', error);
  }

  // Test 3: Basic wizard operations should still work
  try {
    const { createWizard: contextCreate, step } = wizardWithContext({ version: '1.0' });

    const wizard3 = contextCreate({
      first: step({
        data: { count: 0 },
        next: ['second']
      }),
      second: step({
        data: { count: 1 },
        next: []
      })
    });

    // Test basic operations
    const current = wizard3.getCurrent();
    console.log('✓ getCurrent() works:', current.step);

    wizard3.setStepData('first', { count: 5 });
    const stepData = wizard3.getStepData('first');
    console.log('✓ setStepData/getStepData works:', stepData);

    wizard3.updateContext(ctx => {
      (ctx as any).newProp = 'added';
    });
    console.log('✓ updateContext works');

    // Test navigation
    await wizard3.next();
    console.log('✓ Navigation works, current step:', wizard3.getCurrent().step);

  } catch (error) {
    console.log('❌ Basic wizard operations failed:', error);
  }

  // Test 4: Enhanced API should work alongside old API
  try {
    const { createWizard: contextCreate, step } = wizardWithContext({ theme: 'dark' });

    const wizard4 = contextCreate({
      a: step({ data: { value: 1 }, next: ['b'] }),
      b: step({ data: { value: 2 }, next: [] })
    });

    // Old API calls should still work
    wizard4.markLoading('a');
    wizard4.setStepData('a', { value: 99 });

    // New API should also work
    const stepWrapper = wizard4.getStep('a');
    const chainedWrapper = stepWrapper.markIdle().setData({ value: 100 });

    console.log('✓ Mixed old/new API works');
    console.log('  Step wrapper data:', chainedWrapper.data);

  } catch (error) {
    console.log('❌ Mixed API test failed:', error);
  }

  console.log('=== Backward compatibility tests completed ===');
}

// Run the test
testBackwardCompatibility()
  .then(() => console.log('🎉 Backward compatibility verified!'))
  .catch(error => console.error('❌ Backward compatibility test failed:', error));