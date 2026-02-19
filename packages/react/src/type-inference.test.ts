import { describe, expectTypeOf, it } from 'vitest';
import type { DataMapFromDefs, ErrorMapFromDefs } from '@wizard/core';
import { createReactWizardFactory } from './factory';
import { useStepError } from './hooks';
import type { StepComponentProps } from './types';

describe('react type inference', () => {
  it('infers typed step errors through factory and hook signatures', () => {
    type Context = { locale: 'en' | 'fr' };

    const factory = createReactWizardFactory<Context, Error>();
    const steps = factory.defineSteps({
      account: factory.step({
        data: { email: '' },
        next: ['review'],
      }),
      review: factory.step<{ accepted: boolean }, TypeError>({
        data: { accepted: false },
      }),
    });

    const wizard = factory.createWizard(steps, {
      context: { locale: 'en' },
    });

    type Steps = keyof typeof steps & string;
    type DataMap = DataMapFromDefs<typeof steps>;
    type ErrorMap = ErrorMapFromDefs<typeof steps, Error>;

    expectTypeOf(wizard.getStep('account').error).toEqualTypeOf<Error | undefined>();
    expectTypeOf(wizard.getStep('review').error).toEqualTypeOf<TypeError | undefined>();

    const errorWithWizard = (instance: typeof wizard) => useStepError(instance, 'review');
    expectTypeOf<ReturnType<typeof errorWithWizard>>().toEqualTypeOf<
      TypeError | undefined
    >();

    const errorByName = (step: 'account') =>
      useStepError<Context, Steps, DataMap, never, ErrorMap, 'account'>(step);
    expectTypeOf<ReturnType<typeof errorByName>>().toEqualTypeOf<Error | undefined>();

    const currentStepError = (instance: typeof wizard) => useStepError(instance);
    expectTypeOf<ReturnType<typeof currentStepError>>().toEqualTypeOf<
      Error | TypeError | undefined
    >();
  });

  it('keeps event typing as the 3rd createReactWizardFactory generic', () => {
    type Context = { locale: 'en' | 'fr' };
    type WizardEvent = { type: 'track'; step: string };

    const factory = createReactWizardFactory<Context, Error, WizardEvent>();
    const steps = factory.defineSteps({
      account: factory.step<{ email: string }>({
        data: { email: '' },
        next: [],
        beforeEnter: ({ emit }) => {
          emit({ type: 'track', step: 'account' });
          // @ts-expect-error invalid event payload
          emit({ type: 'invalid', value: 1 });
        },
      }),
    });

    const wizard = factory.createWizard(steps, {
      context: { locale: 'en' },
    });

    expectTypeOf(wizard.getStep('account').error).toEqualTypeOf<Error | undefined>();
  });

  it('types injected component props and keeps strict component compatibility', () => {
    type Context = { locale: 'en' | 'fr' };
    type StepName = 'account' | 'review';
    type WizardData = {
      account: { email: string };
      review: { accepted: boolean };
    };
    type WizardErrors = {
      account: Error;
      review: TypeError;
    };

    type AccountProps = StepComponentProps<
      Context,
      StepName,
      WizardData,
      never,
      'account',
      WizardErrors
    >;

    expectTypeOf<AccountProps['wizardData']>().toEqualTypeOf<Partial<WizardData>>();
    expectTypeOf<AccountProps['step']['name']>().toEqualTypeOf<'account'>();
    expectTypeOf<AccountProps['step']['data']>().toEqualTypeOf<
      Readonly<WizardData['account']> | undefined
    >();

    const factory = createReactWizardFactory<Context, Error>();

    const strictComponent = (
      _props: StepComponentProps<
        Context,
        string,
        Record<string, { email: string }>,
        never,
        string,
        Record<string, unknown>
      >
    ) => null;

    const legacyComponent = () => null;

    factory.step<{ email: string }>({
      data: { email: '' },
      component: strictComponent,
      next: [],
    });

    factory.step<{ email: string }>({
      data: { email: '' },
      component: legacyComponent,
      next: [],
    });

    const incompatibleComponent = (
      _props: StepComponentProps<
        Context,
        string,
        Record<string, { email: string }>,
        never,
        string,
        Record<string, unknown>
      > & { requiredExtra: string }
    ) => null;

    factory.step<{ email: string }>({
      data: { email: '' },
      // @ts-expect-error runtime only injects wizard step props
      component: incompatibleComponent,
      next: [],
    });
  });
});
