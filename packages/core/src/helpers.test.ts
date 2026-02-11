import { describe, expect, it } from 'vitest';
import { createWizard } from './wizard';
import { defineSteps } from './types';
import { step } from './step-helpers';

type Context = {
  allowBilling: boolean;
};

const steps = defineSteps({
  account: step({
    data: { email: '' },
    next: ['profile'],
    complete: ({ data }) => Boolean(data?.email),
  }),
  profile: step({
    next: ['billing'],
    complete: ({ data }) => Boolean(data?.firstName && data?.lastName),
  }),
  billing: step({
    next: ['review'],
    required: ({ context }) => context.allowBilling,
    canEnter: ({ context }) => context.allowBilling,
  }),
  review: step({
    next: [],
  }),
});

function createTestWizard(context: Context = { allowBilling: false }) {
  return createWizard({
    context,
    steps,
    order: ['account', 'profile', 'billing', 'review'],
  });
}

describe('wizard helpers', () => {
  it('returns ordered and index helpers', () => {
    const wizard = createTestWizard();

    expect(wizard.helpers.allStepNames()).toEqual(['account', 'profile', 'billing', 'review']);
    expect(wizard.helpers.orderedStepNames()).toEqual([
      'account',
      'profile',
      'billing',
      'review',
    ]);
    expect(wizard.helpers.stepCount()).toBe(4);
    expect(wizard.helpers.currentIndex()).toBe(0);
    expect(wizard.helpers.stepIndex('review')).toBe(3);
  });

  it('computes status and completion helpers', async () => {
    const wizard = createTestWizard();
    await wizard.helpers.refreshAvailability();

    expect(wizard.helpers.stepStatus('account')).toBe('current');
    expect(wizard.helpers.stepStatus('billing')).toBe('unavailable');
    expect(wizard.helpers.isOptional('billing')).toBe(true);
    expect(wizard.helpers.isRequired('billing')).toBe(false);

    wizard.setStepData('account', { email: 'a@b.com' });
    expect(wizard.helpers.completedStepNames()).toContain('account');
    expect(wizard.helpers.firstIncompleteStepName()).toBe('profile');
    expect(wizard.helpers.lastCompletedStepName()).toBe('account');
  });

  it('computes progress from required steps', () => {
    const wizard = createTestWizard();

    expect(wizard.helpers.progress()).toEqual({
      ratio: 0,
      percent: 0,
      label: '0/3 steps completed',
    });

    wizard.setStepData('account', { email: 'a@b.com' });
    wizard.setStepData('profile', { firstName: 'Ada', lastName: 'Lovelace' });

    expect(wizard.helpers.progress()).toEqual({
      ratio: 2 / 3,
      percent: 67,
      label: '2/3 steps completed',
    });
  });

  it('finds next and previous available step names', async () => {
    const wizard = createTestWizard({ allowBilling: true });

    expect(wizard.helpers.findNextAvailableName()).toBe('profile');
    wizard.setStepData('account', { email: 'a@b.com' });
    await wizard.next();

    expect(wizard.helpers.findPrevAvailableName()).toBe('account');
    expect(wizard.helpers.canGoBack()).toBe(true);
  });

  it('refreshes async availability guards without throwing', async () => {
    let canEnterReview = false;
    const guarded = createWizard({
      context: {},
      steps: defineSteps({
        one: step({ data: {}, next: ['two'] }),
        two: step({
          data: {},
          next: ['review'],
        }),
        review: step({
          data: {},
          next: [],
          canEnter: async () => canEnterReview,
        }),
      }),
    });

    await expect(guarded.helpers.refreshAvailability()).resolves.toBeUndefined();
    canEnterReview = true;
    await expect(guarded.helpers.refreshAvailability()).resolves.toBeUndefined();
  });
});
