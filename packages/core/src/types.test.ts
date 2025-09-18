/**
 * Type tests to ensure literal types are preserved through helpers
 * These tests are compile-time only - they ensure TypeScript types work correctly
 */
import { describe, it, expectTypeOf } from 'vitest';
import { createWizard } from './wizard';
import type { WizardConfig, StepStatus } from './types';

describe('Type Tests', () => {
  it('should preserve literal types through helpers', () => {

type Context = { userId?: string };
type Steps = 'intro' | 'details' | 'confirm' | 'done';
type StepData = {
  intro: { welcome: boolean };
  details: { name: string; email: string };
  confirm: { agreed: boolean };
  done: { timestamp: number };
};

const config: WizardConfig<Context, Steps, StepData> = {
  initialStep: 'intro',
  initialContext: {},
  steps: {
    intro: { next: ['details'] },
    details: { next: ['confirm'] },
    confirm: { next: ['done'] },
    done: { next: [] },
  },
  order: ['intro', 'details', 'confirm', 'done'],
  isOptional: (step) => step === 'details',
  prerequisites: {
    confirm: ['intro', 'details'],
    done: ['confirm'],
  },
};

    const wizard = createWizard(config);

    // Test that helpers return correct literal types
    const allSteps = wizard.helpers.allSteps();
    expectTypeOf(allSteps).toEqualTypeOf<readonly Steps[]>();

    const orderedSteps = wizard.helpers.orderedSteps();
    expectTypeOf(orderedSteps).toEqualTypeOf<readonly Steps[]>();

    const currentIndex = wizard.helpers.currentIndex();
    expectTypeOf(currentIndex).toBeNumber();

    const stepIndex = wizard.helpers.stepIndex('details');
    expectTypeOf(stepIndex).toBeNumber();

    // Test status returns
    const status = wizard.helpers.stepStatus('intro');
    expectTypeOf(status).toEqualTypeOf<StepStatus>();

    // Test boolean returns
    const isOptional = wizard.helpers.isOptional('details');
    expectTypeOf(isOptional).toBeBoolean();

    const isRequired = wizard.helpers.isRequired('confirm');
    expectTypeOf(isRequired).toBeBoolean();

    // Test step finding
    const firstIncomplete = wizard.helpers.firstIncompleteStep();
    expectTypeOf(firstIncomplete).toEqualTypeOf<Steps | null>();

    const lastCompleted = wizard.helpers.lastCompletedStep();
    expectTypeOf(lastCompleted).toEqualTypeOf<Steps | null>();

    const nextAvailable = wizard.helpers.findNextAvailable();
    expectTypeOf(nextAvailable).toEqualTypeOf<Steps | null>();

    const prevAvailable = wizard.helpers.findPrevAvailable();
    expectTypeOf(prevAvailable).toEqualTypeOf<Steps | null>();

    const nextRequired = wizard.helpers.jumpToNextRequired();
    expectTypeOf(nextRequired).toEqualTypeOf<Steps | null>();

    // Test arrays of steps
    const available = wizard.helpers.availableSteps();
    expectTypeOf(available).toEqualTypeOf<readonly Steps[]>();

    const unavailable = wizard.helpers.unavailableSteps();
    expectTypeOf(unavailable).toEqualTypeOf<readonly Steps[]>();

    const completed = wizard.helpers.completedSteps();
    expectTypeOf(completed).toEqualTypeOf<readonly Steps[]>();

    const remaining = wizard.helpers.remainingSteps();
    expectTypeOf(remaining).toEqualTypeOf<readonly Steps[]>();

    // Test prerequisites
    const prereqs = wizard.helpers.prerequisitesFor('confirm');
    expectTypeOf(prereqs).toEqualTypeOf<readonly Steps[]>();

    const successors = wizard.helpers.successorsOf('intro');
    expectTypeOf(successors).toEqualTypeOf<readonly Steps[]>();

    // Test progress
    const progress = wizard.helpers.progress();
    expectTypeOf(progress).toEqualTypeOf<{ ratio: number; percent: number; label: string }>();

    // Test diagnostics
    const attempts = wizard.helpers.stepAttempts('intro');
    expectTypeOf(attempts).toBeNumber();

    const duration = wizard.helpers.stepDuration('intro');
    expectTypeOf(duration).toEqualTypeOf<number | null>();

    const percentComplete = wizard.helpers.percentCompletePerStep();
    expectTypeOf(percentComplete).toEqualTypeOf<Record<Steps, number>>();

    // Test navigation checks
    const canGoNext = wizard.helpers.canGoNext();
    expectTypeOf(canGoNext).toBeBoolean();

    const canGoBack = wizard.helpers.canGoBack();
    expectTypeOf(canGoBack).toBeBoolean();

    const canGoTo = wizard.helpers.canGoTo('confirm');
    expectTypeOf(canGoTo).toBeBoolean();

    // Test reachability
    const isReachable = wizard.helpers.isReachable('done');
    expectTypeOf(isReachable).toBeBoolean();

    // Test completion
    const isComplete = wizard.helpers.isComplete();
    expectTypeOf(isComplete).toBeBoolean();

    const remainingRequired = wizard.helpers.remainingRequiredCount();
    expectTypeOf(remainingRequired).toBeNumber();

    // Test async methods
    const refreshPromise = wizard.helpers.refreshAvailability();
    expectTypeOf(refreshPromise).toEqualTypeOf<Promise<void>>();

    // Test mark methods accept correct step types
    wizard.markError('intro', new Error('Test error'));
    wizard.markTerminated('details', new Error('Fatal error'));
    wizard.markLoading('confirm');
    wizard.markIdle('confirm');
    wizard.markSkipped('details');

    // Type errors should occur for invalid steps
    // @ts-expect-error - 'invalid' is not a valid step
    wizard.helpers.stepStatus('invalid');

    // @ts-expect-error - 'unknown' is not a valid step
    wizard.markError('unknown', new Error());

    // @ts-expect-error - 'nonexistent' is not a valid step
    wizard.helpers.stepIndex('nonexistent');
  });
});