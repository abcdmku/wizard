import { describe, expect, it } from 'vitest';
import { createWizard } from '../wizard';
import { defineSteps } from '../types';
import { step } from '../step-helpers';

describe('step attributes', () => {
  it('resolves required as boolean/function', () => {
    const wizard = createWizard({
      context: { skipOptional: true },
      steps: defineSteps({
        start: step({
          data: { ok: true },
          next: ['optional', 'required'],
          required: true,
        }),
        optional: step({
          next: ['required'],
          required: ({ context }) => !context.skipOptional,
        }),
        required: step({
          data: { value: '' },
          next: [],
        }),
      }),
    });

    expect(wizard.helpers.isRequired('start')).toBe(true);
    expect(wizard.helpers.isOptional('optional')).toBe(true);
    expect(wizard.helpers.stepStatus('optional')).toBe('optional');
  });

  it('uses complete callback for completedStepNames', () => {
    const wizard = createWizard({
      context: {},
      steps: defineSteps({
        one: step({
          data: { done: false },
          next: ['two'],
          complete: ({ data }) => Boolean(data?.done),
        }),
        two: step({
          next: [],
        }),
      }),
    });

    expect(wizard.helpers.completedStepNames()).toEqual([]);
    wizard.setStepData('one', { done: true });
    expect(wizard.helpers.completedStepNames()).toEqual(['one']);
  });

  it('returns prerequisites and successors from definitions/order', () => {
    const wizard = createWizard({
      context: {},
      order: ['start', 'middle', 'end'],
      steps: defineSteps({
        start: step({
          data: {},
          next: ['middle'],
        }),
        middle: step({
          data: {},
          next: ['end'],
          prerequisites: ['start'],
        }),
        end: step({
          data: {},
          next: [],
          prerequisites: ['middle'],
        }),
      }),
    });

    expect(wizard.helpers.prerequisitesFor('middle')).toEqual(['start']);
    expect(wizard.helpers.successorsOf('start')).toEqual(['middle', 'end']);
  });

  it('stores and updates step meta through wizard accessors', () => {
    const wizard = createWizard({
      context: {},
      steps: defineSteps({
        profile: step({
          data: { name: '' },
          next: [],
        }),
      }),
    });

    wizard.setStepMeta('profile', {
      label: 'Profile',
      description: 'Edit your profile',
    });

    wizard.updateStepMeta('profile', {
      tooltip: 'Visible in sidebar',
    });

    expect(wizard.getStepMeta('profile')).toMatchObject({
      label: 'Profile',
      description: 'Edit your profile',
      tooltip: 'Visible in sidebar',
    });
  });
});
