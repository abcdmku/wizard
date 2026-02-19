import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { createReactWizardFactory } from './factory';
import { wrapWithReactStep } from './step-wrapper';

describe('react step wrapper', () => {
  it('injects runtime props into rendered step components', () => {
    type Context = { locale: 'en' | 'fr' };

    const factory = createReactWizardFactory<Context, Error>();
    const AccountStep = () => null;

    const steps = factory.defineSteps({
      account: factory.step({
        data: { email: '' },
        component: AccountStep,
        next: [],
      }),
    });

    const wizard = factory.createWizard(steps, {
      context: { locale: 'en' },
    });

    wizard.setStepData('account', { email: 'user@example.com' });

    const wrappedStep = wrapWithReactStep(wizard.getStep('account'), (stepName) =>
      wizard.getStepComponent(stepName)
    );
    const rendered = wrappedStep.component;

    expect(React.isValidElement(rendered)).toBe(true);
    if (!React.isValidElement(rendered)) {
      return;
    }

    expect(rendered.props.step.name).toBe('account');
    expect(rendered.props.step.data).toEqual({ email: 'user@example.com' });
    expect(rendered.props.data).toEqual({ email: 'user@example.com' });
    expect(rendered.props.wizardData).toEqual(wizard.data);
    expect(rendered.props.context).toEqual(wizard.context);
    expect(rendered.props.wizard).toBe(wizard);
  });
});
