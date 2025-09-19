import { describe, it, expect } from 'vitest';
import { createWizard } from '../wizard';
import { migrateWizardConfig, hasDeprecatedProperties, getDeprecationReport } from '../utils/migrate';

describe('Step-level Attributes', () => {
  describe('required attribute', () => {
    it('should use step.required when defined as boolean', () => {
      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: {},
        steps: {
          step1: {
            next: ['step2' as const],
            required: true
          },
          step2: {
            next: ['step3' as const],
            required: false  // Optional step
          },
          step3: {
            next: [],
            required: true
          }
        }
      });

      expect(wizard.helpers.isRequired('step1')).toBe(true);
      expect(wizard.helpers.isRequired('step2')).toBe(false);
      expect(wizard.helpers.isRequired('step3')).toBe(true);

      expect(wizard.helpers.isOptional('step1')).toBe(false);
      expect(wizard.helpers.isOptional('step2')).toBe(true);
      expect(wizard.helpers.isOptional('step3')).toBe(false);
    });

    it('should use step.required when defined as function', () => {
      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: { userRole: 'admin' },
        steps: {
          step1: {
            next: ['step2' as const],
            required: (ctx) => ctx.userRole !== 'admin'  // Not required for admins
          },
          step2: {
            next: [],
            required: (ctx) => ctx.userRole === 'user'  // Only required for users
          }
        }
      });

      expect(wizard.helpers.isRequired('step1')).toBe(false);  // Admin context
      expect(wizard.helpers.isRequired('step2')).toBe(false);  // Admin context

      wizard.updateContext((ctx) => { ctx.userRole = 'user'; });

      expect(wizard.helpers.isRequired('step1')).toBe(true);   // User context
      expect(wizard.helpers.isRequired('step2')).toBe(true);   // User context
    });
  });

  describe('complete attribute', () => {
    it('should use step.complete as boolean', () => {
      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: {},
        steps: {
          step1: {
            next: ['step2' as const],
            complete: true  // Always complete
          },
          step2: {
            next: [],
            complete: false  // Never complete
          }
        }
      });

      expect(wizard.helpers.completedSteps()).toEqual(['step1']);

      wizard.setStepData('step2', { data: 'test' });
      expect(wizard.helpers.completedSteps()).toEqual(['step1']); // step2 still not complete
    });

    it('should use step.complete as function', () => {
      interface StepData {
        value?: number;
      }

      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: { threshold: 10 },
        steps: {
          step1: {
            next: [],
            complete: (data: StepData | undefined, ctx) => {
              return !!data && !!data.value && data.value > ctx.threshold;
            }
          }
        }
      });

      expect(wizard.helpers.completedSteps()).toEqual([]);

      wizard.setStepData('step1', { value: 5 });
      expect(wizard.helpers.completedSteps()).toEqual([]); // Below threshold

      wizard.setStepData('step1', { value: 15 });
      expect(wizard.helpers.completedSteps()).toEqual(['step1']); // Above threshold
    });
  });

  describe('weight attribute', () => {
    it('should use step.weight as number', () => {
      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: {},
        steps: {
          step1: {
            next: ['step2' as const],
            weight: 1
          },
          step2: {
            next: ['step3' as const],
            weight: 2
          },
          step3: {
            next: [],
            weight: 3
          }
        }
      });

      const progress1 = wizard.helpers.progress();
      expect(progress1.percent).toBe(0);

      wizard.setStepData('step1', { done: true });
      const progress2 = wizard.helpers.progress();
      expect(progress2.percent).toBe(17); // 1/6 = 16.67%

      wizard.setStepData('step2', { done: true });
      const progress3 = wizard.helpers.progress();
      expect(progress3.percent).toBe(50); // 3/6 = 50%

      wizard.setStepData('step3', { done: true });
      const progress4 = wizard.helpers.progress();
      expect(progress4.percent).toBe(100); // 6/6 = 100%
    });

    it('should use step.weight as function', () => {
      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: { difficulty: 'hard' },
        steps: {
          step1: {
            next: ['step2' as const],
            weight: (ctx) => ctx.difficulty === 'hard' ? 3 : 1
          },
          step2: {
            next: [],
            weight: (ctx) => ctx.difficulty === 'hard' ? 2 : 1
          }
        }
      });

      // Hard difficulty: total weight = 5
      wizard.setStepData('step1', { done: true });
      let progress = wizard.helpers.progress();
      expect(progress.percent).toBe(60); // 3/5 = 60%

      // Change to easy difficulty
      wizard.updateContext((ctx) => { ctx.difficulty = 'easy'; });
      progress = wizard.helpers.progress();
      expect(progress.percent).toBe(50); // 1/2 = 50% (weights changed)
    });
  });

  describe('prerequisites attribute', () => {
    it('should use step.prerequisites', () => {
      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: {},
        steps: {
          step1: {
            next: ['step2' as const, 'step3' as const]
          },
          step2: {
            next: ['step3' as const]
          },
          step3: {
            next: [],
            prerequisites: ['step1' as const, 'step2' as const]
          }
        }
      });

      expect(wizard.helpers.prerequisitesFor('step3')).toEqual(['step1', 'step2']);
      expect(wizard.helpers.isReachable('step3')).toBe(false);

      wizard.setStepData('step1', { done: true });
      expect(wizard.helpers.isReachable('step3')).toBe(false); // Still missing step2

      wizard.setStepData('step2', { done: true });
      expect(wizard.helpers.isReachable('step3')).toBe(true); // All prerequisites met
    });
  });

  describe('combined attributes', () => {
    it('should work with all attributes together', () => {
      const wizard = createWizard({
        initialStep: 'intro' as const,
        initialContext: { userType: 'premium' },
        steps: {
          intro: {
            next: ['basic' as const, 'advanced' as const],
            required: true,
            weight: 1
          },
          basic: {
            next: ['confirm' as const],
            required: (ctx) => ctx.userType === 'basic',
            weight: 2,
            complete: (data: any) => !!data?.completed
          },
          advanced: {
            next: ['confirm' as const],
            required: (ctx) => ctx.userType === 'premium',
            weight: 3,
            complete: (data: any) => !!data?.completed
          },
          confirm: {
            next: [],
            prerequisites: ['intro' as const],
            weight: 1
          }
        }
      });

      // Premium user flow
      expect(wizard.helpers.isRequired('basic')).toBe(false);
      expect(wizard.helpers.isRequired('advanced')).toBe(true);

      wizard.setStepData('intro', { done: true });
      wizard.setStepData('advanced', { completed: true });

      const progress = wizard.helpers.progress();
      expect(wizard.helpers.completedSteps()).toContain('intro');
      expect(wizard.helpers.completedSteps()).toContain('advanced');
    });
  });

  describe('migration utilities', () => {
    it('should detect deprecated properties', () => {
      const oldConfig = {
        initialStep: 'step1' as const,
        initialContext: {},
        weights: { step1: 2 },
        prerequisites: { step2: ['step1' as const] },
        isOptional: (step: string) => step === 'step3',
        steps: {
          step1: { next: ['step2' as const] },
          step2: { next: [] }
        }
      };

      expect(hasDeprecatedProperties(oldConfig)).toBe(true);

      const warnings = getDeprecationReport(oldConfig);
      expect(warnings).toContain('config.weights is deprecated. Use step.weight instead for each step.');
      expect(warnings).toContain('config.prerequisites is deprecated. Use step.prerequisites instead for each step.');
      expect(warnings).toContain('config.isOptional is deprecated. Use step.required instead (with inverted logic).');
    });

    it('should migrate simple properties', () => {
      const oldConfig = {
        initialStep: 'step1' as const,
        initialContext: {},
        weights: {
          step1: 2,
          step2: 3
        },
        prerequisites: {
          step2: ['step1' as const]
        },
        steps: {
          step1: { next: ['step2' as const] },
          step2: { next: [] }
        }
      };

      const newConfig = migrateWizardConfig(oldConfig);

      expect(newConfig.weights).toBeUndefined();
      expect(newConfig.prerequisites).toBeUndefined();
      expect((newConfig.steps.step1 as any).weight).toBe(2);
      expect((newConfig.steps.step2 as any).weight).toBe(3);
      expect((newConfig.steps.step2 as any).prerequisites).toEqual(['step1']);
    });
  });

  describe('backward compatibility', () => {
    it('should prefer step-level over wizard-level properties', () => {
      const wizard = createWizard({
        initialStep: 'step1' as const,
        initialContext: {},
        // Old wizard-level (will be ignored for step1)
        isOptional: () => true,
        weights: { step1: 1, step2: 1 },
        steps: {
          step1: {
            next: ['step2' as const],
            required: true,  // New step-level (takes precedence)
            weight: 5        // New step-level (takes precedence)
          },
          step2: {
            next: []
            // Will use wizard-level for this step
          }
        }
      });

      expect(wizard.helpers.isRequired('step1')).toBe(true); // Uses step-level
      expect(wizard.helpers.isOptional('step2')).toBe(true); // Uses wizard-level

      wizard.setStepData('step1', { done: true });
      const progress = wizard.helpers.progress();
      // step1 weight=5, step2 weight=1, completed=5/6
      expect(progress.percent).toBe(83); // 5/6 = 83.33%
    });
  });
});