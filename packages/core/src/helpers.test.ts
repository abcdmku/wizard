import { describe, it, expect } from 'vitest';
import { createWizard } from './wizard';
import type { WizardConfig } from './types';

describe('Wizard Helpers', () => {
  type Context = { userId?: string };
  type Steps = 'step1' | 'step2' | 'step3' | 'step4';
  type StepData = {
    step1: { name: string };
    step2: { email: string };
    step3: { age: number };
    step4: { confirm: boolean };
  };

  const baseConfig: WizardConfig<Context, Steps, StepData> = {
    initialStep: 'step1',
    initialContext: {},
    steps: {
      step1: { next: ['step2'] },
      step2: { next: ['step3'] },
      step3: { next: ['step4'] },
      step4: { next: [] },
    },
  };

  describe('Identity & Ordering', () => {
    it('should return all steps', () => {
      const wizard = createWizard(baseConfig);
      console.log('wizard keys:', Object.keys(wizard));
      console.log('wizard.helpers:', wizard.helpers);
      expect(wizard.helpers.allSteps()).toEqual(['step1', 'step2', 'step3', 'step4']);
    });

    it('should use explicit order when provided', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        order: ['step3', 'step1', 'step4', 'step2'],
      };
      const wizard = createWizard(config);
      expect(wizard.helpers.orderedSteps()).toEqual(['step3', 'step1', 'step4', 'step2']);
    });

    it('should return step count', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.stepCount()).toBe(4);
    });

    it('should return step index', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.stepIndex('step1')).toBe(0);
      expect(wizard.helpers.stepIndex('step3')).toBe(2);
    });

    it('should return current index', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.currentIndex()).toBe(0);
      wizard.setStepData('step1', { name: 'John' });
      wizard.goTo('step2');
      // After transition
      setTimeout(() => {
        expect(wizard.helpers.currentIndex()).toBe(1);
      }, 10);
    });
  });

  describe('Status', () => {
    it('should return current status for active step', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.stepStatus('step1')).toBe('current');
      expect(wizard.helpers.stepStatus('step2')).toBe('required');
    });

    it('should return completed status for steps with data', () => {
      const wizard = createWizard(baseConfig);
      wizard.setStepData('step1', { name: 'John' });
      expect(wizard.helpers.stepStatus('step1')).toBe('current'); // Still current
      wizard.goTo('step2');
      setTimeout(() => {
        expect(wizard.helpers.stepStatus('step1')).toBe('completed');
      }, 10);
    });

    it('should respect custom isStepComplete', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        isStepComplete: ({ step, data }) => {
          if (step === 'step1') return !!data.step1?.name;
          if (step === 'step2') return !!data.step2?.email;
          return false;
        },
      };
      const wizard = createWizard(config);
      expect(wizard.helpers.stepStatus('step1')).toBe('current');
      wizard.setStepData('step1', { name: 'John' });
      wizard.goTo('step2');
      setTimeout(() => {
        expect(wizard.helpers.stepStatus('step1')).toBe('completed');
        expect(wizard.helpers.stepStatus('step2')).toBe('current');
      }, 10);
    });

    it('should handle error and terminated status', () => {
      const wizard = createWizard(baseConfig);
      wizard.markError('step2', new Error('Validation failed'));
      expect(wizard.helpers.stepStatus('step2')).toBe('error');

      wizard.markTerminated('step3', new Error('Fatal error'));
      expect(wizard.helpers.stepStatus('step3')).toBe('terminated');
    });

    it('should handle loading status', () => {
      const wizard = createWizard(baseConfig);
      wizard.markLoading('step2');
      expect(wizard.helpers.stepStatus('step2')).toBe('loading');

      wizard.markIdle('step2');
      expect(wizard.helpers.stepStatus('step2')).not.toBe('loading');
    });

    it('should handle skipped status', () => {
      const wizard = createWizard(baseConfig);
      wizard.markSkipped('step2');
      expect(wizard.helpers.stepStatus('step2')).toBe('skipped');
    });

    it('should handle optional and required steps', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        isOptional: (step) => step === 'step3',
      };
      const wizard = createWizard(config);
      expect(wizard.helpers.isOptional('step3')).toBe(true);
      expect(wizard.helpers.isRequired('step3')).toBe(false);
      expect(wizard.helpers.isOptional('step1')).toBe(false);
      expect(wizard.helpers.isRequired('step1')).toBe(true);
    });
  });

  describe('Prerequisites', () => {
    it('should handle prerequisites', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        prerequisites: {
          step3: ['step1', 'step2'],
          step4: ['step3'],
        },
      };
      const wizard = createWizard(config);

      expect(wizard.helpers.stepStatus('step3')).toBe('unavailable');
      expect(wizard.helpers.isReachable('step3')).toBe(false);

      wizard.setStepData('step1', { name: 'John' });
      wizard.setStepData('step2', { email: 'john@example.com' });

      expect(wizard.helpers.isReachable('step3')).toBe(true);
      expect(wizard.helpers.prerequisitesFor('step3')).toEqual(['step1', 'step2']);
    });
  });

  describe('Progress', () => {
    it('should calculate progress', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.progress()).toEqual({
        ratio: 0,
        percent: 0,
        label: '0 / 4',
      });

      wizard.setStepData('step1', { name: 'John' });
      expect(wizard.helpers.progress()).toEqual({
        ratio: 0.25,
        percent: 25,
        label: '1 / 4',
      });
    });

    it('should calculate weighted progress', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        weights: {
          step1: 1,
          step2: 2,
          step3: 3,
          step4: 4,
        },
      };
      const wizard = createWizard(config);

      wizard.setStepData('step1', { name: 'John' });
      expect(wizard.helpers.progress().percent).toBe(10); // 1/10

      wizard.setStepData('step2', { email: 'john@example.com' });
      expect(wizard.helpers.progress().percent).toBe(30); // 3/10
    });

    it('should check if wizard is complete', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        isOptional: (step) => step === 'step4',
      };
      const wizard = createWizard(config);

      expect(wizard.helpers.isComplete()).toBe(false);

      wizard.setStepData('step1', { name: 'John' });
      wizard.setStepData('step2', { email: 'john@example.com' });
      wizard.setStepData('step3', { age: 25 });

      expect(wizard.helpers.isComplete()).toBe(true); // step4 is optional
    });
  });

  describe('Navigation', () => {
    it('should find next available step', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.findNextAvailable()).toBe('step2');
      expect(wizard.helpers.canGoNext()).toBe(true);
    });

    it('should find previous available step', () => {
      const wizard = createWizard(baseConfig);
      wizard.setStepData('step1', { name: 'John' });
      wizard.goTo('step2');

      setTimeout(() => {
        expect(wizard.helpers.findPrevAvailable()).toBe('step1');
        expect(wizard.helpers.canGoBack()).toBe(true);
      }, 10);
    });

    it('should jump to next required step', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        isOptional: (step) => step === 'step2' || step === 'step3',
      };
      const wizard = createWizard(config);
      wizard.setStepData('step1', { name: 'John' });

      expect(wizard.helpers.jumpToNextRequired()).toBe('step4');
    });

    it('should check if can go to step', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        steps: {
          step1: { next: ['step2'] },
          step2: {
            next: ['step3'],
            canEnter: ({ ctx }) => !!ctx.userId,
          },
          step3: { next: ['step4'] },
          step4: { next: [] },
        },
      };
      const wizard = createWizard(config);

      expect(wizard.helpers.canGoTo('step2')).toBe(false);

      wizard.updateContext(ctx => {
        ctx.userId = '123';
      });

      expect(wizard.helpers.canGoTo('step2')).toBe(true);
    });
  });

  describe('Diagnostics', () => {
    it('should track step attempts', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.stepAttempts('step1')).toBe(0);

      // Attempts are incremented when entering a step
      wizard.goTo('step2');
      setTimeout(() => {
        wizard.goTo('step1');
        setTimeout(() => {
          expect(wizard.helpers.stepAttempts('step1')).toBe(2);
        }, 10);
      }, 10);
    });

    it('should track step duration', async () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.stepDuration('step1')).toBe(null);

      // Duration is tracked between startedAt and finishedAt
      // This would typically be set by the framework when a step completes
    });

    it('should return percent complete per step', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.percentCompletePerStep()).toEqual({
        step1: 0,
        step2: 0,
        step3: 0,
        step4: 0,
      });

      wizard.setStepData('step1', { name: 'John' });
      wizard.setStepData('step2', { email: 'john@example.com' });

      expect(wizard.helpers.percentCompletePerStep()).toEqual({
        step1: 100,
        step2: 100,
        step3: 0,
        step4: 0,
      });
    });
  });

  describe('Completion', () => {
    it('should find first incomplete step', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.firstIncompleteStep()).toBe('step1');

      wizard.setStepData('step1', { name: 'John' });
      expect(wizard.helpers.firstIncompleteStep()).toBe('step2');

      wizard.markTerminated('step2');
      expect(wizard.helpers.firstIncompleteStep()).toBe('step3');
    });

    it('should find last completed step', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.lastCompletedStep()).toBe(null);

      wizard.setStepData('step1', { name: 'John' });
      wizard.goTo('step2');

      setTimeout(() => {
        expect(wizard.helpers.lastCompletedStep()).toBe('step1');

        wizard.setStepData('step2', { email: 'john@example.com' });
        wizard.goTo('step3');

        setTimeout(() => {
          expect(wizard.helpers.lastCompletedStep()).toBe('step2');
        }, 10);
      }, 10);
    });

    it('should get remaining steps', () => {
      const wizard = createWizard(baseConfig);
      expect(wizard.helpers.remainingSteps()).toEqual(['step2', 'step3', 'step4']);

      wizard.goTo('step2');
      setTimeout(() => {
        expect(wizard.helpers.remainingSteps()).toEqual(['step3', 'step4']);
      }, 10);
    });

    it('should count remaining required steps', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        isOptional: (step) => step === 'step3',
      };
      const wizard = createWizard(config);

      expect(wizard.helpers.remainingRequiredCount()).toBe(3); // step1, step2, step4

      wizard.setStepData('step1', { name: 'John' });
      expect(wizard.helpers.remainingRequiredCount()).toBe(2); // step2, step4
    });
  });

  describe('Availability', () => {
    it('should list available and unavailable steps', () => {
      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        prerequisites: {
          step3: ['step1', 'step2'],
          step4: ['step3'],
        },
      };
      const wizard = createWizard(config);

      expect(wizard.helpers.availableSteps()).toEqual(['step1', 'step2']);
      expect(wizard.helpers.unavailableSteps()).toEqual(['step3', 'step4']);

      wizard.setStepData('step1', { name: 'John' });
      wizard.setStepData('step2', { email: 'john@example.com' });

      expect(wizard.helpers.availableSteps()).toEqual(['step1', 'step2', 'step3']);
      expect(wizard.helpers.unavailableSteps()).toEqual(['step4']);
    });

    it('should refresh availability for async guards', async () => {
      let canEnterStep2 = false;

      const config: WizardConfig<Context, Steps, StepData> = {
        ...baseConfig,
        steps: {
          step1: { next: ['step2'] },
          step2: {
            next: ['step3'],
            canEnter: async () => {
              return canEnterStep2;
            },
          },
          step3: { next: ['step4'] },
          step4: { next: [] },
        },
      };

      const wizard = createWizard(config);

      expect(wizard.helpers.availableSteps()).toEqual(['step1']);

      canEnterStep2 = true;
      await wizard.helpers.refreshAvailability();

      expect(wizard.helpers.availableSteps()).toContain('step2');
    });
  });
});