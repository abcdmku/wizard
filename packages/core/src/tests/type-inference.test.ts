import { describe, expect, expectTypeOf, it } from 'vitest';
import { createWizard } from '../wizard';
import { createWizardFactory } from '../wizard-factory';
import { defineSteps } from '../types';
import { step } from '../step-helpers';

describe('type inference', () => {
  it('infers per-step data from step() helpers', () => {
    const steps = defineSteps({
      account: step({
        data: { email: '' },
        next: ['review'],
        validate: ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<{ email: string }>();
          if (!data.email.includes('@')) {
            throw new Error('Invalid email');
          }
        },
      }),
      review: step({
        data: { agreed: false },
        next: [],
      }),
    });

    const wizard = createWizard({
      context: { locale: 'en-US' },
      steps,
    });

    expectTypeOf(wizard.getStepData('account')).toEqualTypeOf<
      { email: string } | undefined
    >();
    expectTypeOf(wizard.getStepData('review')).toEqualTypeOf<
      { agreed: boolean } | undefined
    >();

    wizard.setStepData('account', { email: 'user@example.com' });
    expect(wizard.getStepData('account')?.email).toBe('user@example.com');
  });

  it('infers data from validate callback when step() helper is not used', () => {
    const wizard = createWizard({
      context: {},
      steps: {
        profile: {
          next: [],
          validate: ({ data }: { data: { fullName: string } }) => {
            if (!data.fullName.trim()) {
              throw new Error('Name is required');
            }
          },
        },
      },
    });

    expectTypeOf(wizard.getStepData('profile')).toEqualTypeOf<
      { fullName: string } | undefined
    >();
  });

  it('keeps strong inference through createWizardFactory', () => {
    const factory = createWizardFactory<{ region: string }>();
    const steps = factory.defineSteps({
      shipping: factory.step({
        data: { country: 'US', postalCode: '' },
        next: ['confirm'],
      }),
      confirm: factory.step({
        data: { accepted: false },
        next: [],
      }),
    });

    const wizard = factory.createWizard(steps, {
      context: { region: 'NA' },
    });

    expectTypeOf(wizard.getStepData('shipping')).toEqualTypeOf<
      { country: string; postalCode: string } | undefined
    >();
    expectTypeOf(wizard.getStepData('confirm')).toEqualTypeOf<
      { accepted: boolean } | undefined
    >();
  });
});
