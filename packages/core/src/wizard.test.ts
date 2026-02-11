import { beforeEach, describe, expect, it } from 'vitest';
import { createWizard } from './wizard';
import { defineSteps } from './types';
import { step } from './step-helpers';

type Context = {
  canAccessDetails: boolean;
  visitCount: number;
};

const steps = defineSteps({
  intro: step({
    data: { accepted: false },
    next: ['details'],
    validate: ({ data }) => {
      if (!data.accepted) {
        throw new Error('Intro must be accepted');
      }
    },
    beforeExit: ({ updateContext }) => {
      updateContext((ctx) => {
        ctx.visitCount += 1;
      });
    },
  }),
  details: step({
    data: { name: '' },
    next: ['done'],
    canEnter: ({ context }) => context.canAccessDetails,
    validate: ({ data }) => {
      if (!data.name.trim()) {
        throw new Error('Name is required');
      }
    },
  }),
  done: step({
    data: { confirmed: false },
    next: [],
  }),
});

describe('createWizard', () => {
  let wizard: ReturnType<typeof createWizard<Context, never, typeof steps>>;

  beforeEach(() => {
    wizard = createWizard({
      context: {
        canAccessDetails: false,
        visitCount: 0,
      },
      steps,
    });
  });

  it('initializes with first step and seeded context/data', () => {
    expect(wizard.step).toBe('intro');
    expect(wizard.context).toEqual({ canAccessDetails: false, visitCount: 0 });
    expect(wizard.getStepData('intro')).toEqual({ accepted: false });
  });

  it('updates context immutably', () => {
    const original = wizard.context;
    wizard.updateContext((ctx) => {
      ctx.canAccessDetails = true;
    });

    expect(wizard.context.canAccessDetails).toBe(true);
    expect(wizard.context).not.toBe(original);
  });

  it('blocks goTo when canEnter guard fails', async () => {
    await expect(wizard.goTo('details')).rejects.toThrow('Cannot go to step');
  });

  it('navigates to next when validation passes and guard is open', async () => {
    wizard.setStepData('intro', { accepted: true });
    wizard.updateContext((ctx) => {
      ctx.canAccessDetails = true;
    });

    await wizard.next();

    expect(wizard.step).toBe('details');
    expect(wizard.context.visitCount).toBe(1);
    expect(wizard.history).toHaveLength(1);
    expect(wizard.history[0]?.step).toBe('intro');
  });

  it('stores validation errors on failure', async () => {
    wizard.setStepData('intro', { accepted: false });

    await expect(wizard.next()).rejects.toThrow('Intro must be accepted');
    expect(wizard.getStepError('intro')).toBeInstanceOf(Error);
  });

  it('supports back navigation through history', async () => {
    wizard.setStepData('intro', { accepted: true });
    wizard.updateContext((ctx) => {
      ctx.canAccessDetails = true;
    });
    await wizard.next();
    wizard.setStepData('details', { name: 'Ada' });
    await wizard.next();

    expect(wizard.step).toBe('done');

    await wizard.back();
    expect(wizard.step).toBe('details');
  });

  it('resets to initial state', async () => {
    wizard.setStepData('intro', { accepted: true });
    wizard.updateContext((ctx) => {
      ctx.canAccessDetails = true;
    });
    await wizard.next();

    wizard.reset();

    expect(wizard.step).toBe('intro');
    expect(wizard.context).toEqual({ canAccessDetails: false, visitCount: 0 });
    expect(wizard.history).toEqual([]);
  });
});
