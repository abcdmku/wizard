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

  it('infers default and per-step error types through createWizardFactory', () => {
    const factory = createWizardFactory<{ region: string }, Error>();
    const steps = factory.defineSteps({
      shipping: factory.step({
        data: { country: 'US' },
        next: ['confirm'],
      }),
      confirm: factory.step<{ accepted: boolean }, TypeError>({
        data: { accepted: false },
        next: [],
      }),
    });

    const wizard = factory.createWizard(steps, {
      context: { region: 'NA' },
    });

    expectTypeOf(wizard.getStepError('shipping')).toEqualTypeOf<Error | undefined>();
    expectTypeOf(wizard.getStepError('confirm')).toEqualTypeOf<TypeError | undefined>();
    expectTypeOf(wizard.getStep('shipping').error).toEqualTypeOf<Error | undefined>();
    expectTypeOf(wizard.getStep('confirm').error).toEqualTypeOf<TypeError | undefined>();

    wizard.markError('shipping', new Error('Shipping failed'));
    wizard.markError('confirm', new TypeError('Confirm failed'));

    // @ts-expect-error confirm step requires TypeError
    wizard.markError('confirm', new Error('Wrong error type'));
  });

  it('keeps event typing as the 3rd createWizardFactory generic', () => {
    type WizardEvent = { type: 'track'; step: string };
    const factory = createWizardFactory<{ region: string }, Error, WizardEvent>();
    const steps = factory.defineSteps({
      shipping: factory.step<{ country: string }>({
        data: { country: 'US' },
        next: [],
        beforeEnter: ({ emit }) => {
          emit({ type: 'track', step: 'shipping' });
          // @ts-expect-error invalid event payload
          emit({ type: 'invalid', value: 1 });
        },
      }),
    });

    const wizard = factory.createWizard(steps, {
      context: { region: 'NA' },
    });

    expectTypeOf(wizard.getStepError('shipping')).toEqualTypeOf<Error | undefined>();
  });

  it('supports default and per-step error typing via direct createWizard', () => {
    const defaultOnlySteps = defineSteps({
      start: {
        data: { ok: false },
        next: ['done'],
      },
      done: {
        data: { finished: true },
        next: [],
      },
    });

    const defaultOnlyWizard = createWizard<
      {},
      never,
      typeof defaultOnlySteps,
      RangeError
    >({
      context: {},
      steps: defaultOnlySteps,
    });

    expectTypeOf(defaultOnlyWizard.getStepError('start')).toEqualTypeOf<
      RangeError | undefined
    >();
    defaultOnlyWizard.markError('start', new RangeError('Start failed'));

    // @ts-expect-error start step uses default RangeError
    defaultOnlyWizard.markError('start', new Error('Wrong error type'));

    const brandedSteps = defineSteps({
      account: step<{ email: string }, unknown, SyntaxError>({
        data: { email: '' },
        next: ['review'],
      }),
      review: step({
        data: { agreed: false },
        next: [],
      }),
    });

    const brandedWizard = createWizard<{}, never, typeof brandedSteps, Error>({
      context: {},
      steps: brandedSteps,
    });

    expectTypeOf(brandedWizard.getStepError('account')).toEqualTypeOf<
      SyntaxError | undefined
    >();
    expectTypeOf(brandedWizard.getStepError('review')).toEqualTypeOf<
      Error | undefined
    >();

    brandedWizard.markError('account', new SyntaxError('Bad account'));
    brandedWizard.markError('review', new Error('Bad review'));

    // @ts-expect-error account step requires SyntaxError
    brandedWizard.markError('account', new Error('Wrong account error'));
  });
});
