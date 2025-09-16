import { describe, it, expect, beforeEach } from 'vitest';
import { createWizard } from './wizard';
import { createZodValidator } from './zod';
import { z } from 'zod';

// Test types
type TestContext = {
  userId?: string;
  count: number;
};

type TestSteps = 'step1' | 'step2' | 'step3';

type TestDataMap = {
  step1: { name: string };
  step2: { age: number };
  step3: { confirmed: boolean };
};

describe('createWizard', () => {
  let wizard: ReturnType<typeof createWizard<TestContext, TestSteps, TestDataMap>>;

  beforeEach(() => {
    wizard = createWizard<TestContext, TestSteps, TestDataMap>({
      initialStep: 'step1',
      initialContext: { count: 0 },
      steps: {
        step1: {
          next: ['step2'],
          validate: (data): asserts data is TestDataMap['step1'] => {
            if (typeof data !== 'object' || data === null || !('name' in data)) {
              throw new Error('Invalid data');
            }
          },
        },
        step2: {
          next: ['step3'],
          canEnter: ({ ctx }) => ctx.count > 0,
        },
        step3: {
          next: [],
        },
      },
    });
  });

  it('should initialize with correct initial state', () => {
    const current = wizard.getCurrent();
    expect(current.step).toBe('step1');
    expect(current.ctx.count).toBe(0);
    expect(current.data).toBeUndefined();
  });

  it('should update context correctly', () => {
    wizard.updateContext((ctx) => {
      ctx.count = 5;
      ctx.userId = 'user123';
    });
    
    const current = wizard.getCurrent();
    expect(current.ctx.count).toBe(5);
    expect(current.ctx.userId).toBe('user123');
  });

  it('should set step data correctly', () => {
    wizard.setStepData('step1', { name: 'John' });
    const state = wizard.snapshot();
    expect(state.data.step1).toEqual({ name: 'John' });
  });

  it('should transition to next step with validation', async () => {
    wizard.updateContext((ctx) => { ctx.count = 1; }); // Enable step2
    await wizard.next({ data: { name: 'Alice' } });
    
    const current = wizard.getCurrent();
    expect(current.step).toBe('step2');
  });

  it('should fail transition with invalid data', async () => {
    await expect(wizard.next({ data: { invalid: 'data' } as any }))
      .rejects.toThrow();
  });

  it('should respect canEnter guard', async () => {
    // Try to go directly to step2 without meeting the guard condition
    await expect(wizard.goTo('step2')).rejects.toThrow();
    
    // Update context to meet the guard
    wizard.updateContext((ctx) => { ctx.count = 1; });
    await wizard.goTo('step2');
    
    expect(wizard.getCurrent().step).toBe('step2');
  });

  it('should maintain history when enabled', async () => {
    wizard.updateContext((ctx) => { ctx.count = 1; });
    await wizard.next({ data: { name: 'Bob' } });
    await wizard.next({ data: { age: 25 } });
    
    const state = wizard.snapshot();
    expect(state.history).toHaveLength(2);
    expect(state.history[0].step).toBe('step1');
    expect(state.history[1].step).toBe('step2');
  });

  it('should go back through history', async () => {
    wizard.updateContext((ctx) => { ctx.count = 1; });
    await wizard.next({ data: { name: 'Charlie' } });
    await wizard.next({ data: { age: 30 } });
    
    expect(wizard.getCurrent().step).toBe('step3');
    
    await wizard.back();
    expect(wizard.getCurrent().step).toBe('step2');
    
    await wizard.back();
    expect(wizard.getCurrent().step).toBe('step1');
  });

  it('should reset to initial state', async () => {
    wizard.updateContext((ctx) => { ctx.count = 10; });
    wizard.setStepData('step1', { name: 'Test' });
    
    wizard.reset();
    
    const current = wizard.getCurrent();
    expect(current.step).toBe('step1');
    expect(current.ctx.count).toBe(0);
    expect(current.data).toBeUndefined();
  });

  it('should handle beforeExit hook', async () => {
    let hookCalled = false;
    
    const wizardWithHook = createWizard<TestContext, TestSteps, TestDataMap>({
      initialStep: 'step1',
      initialContext: { count: 0 },
      steps: {
        step1: {
          next: ['step2'],
          beforeExit: ({ updateContext }) => {
            hookCalled = true;
            updateContext((ctx) => { ctx.count = 100; });
          },
        },
        step2: { next: ['step3'] },
        step3: { next: [] },
      },
    });
    
    await wizardWithHook.next();
    
    expect(hookCalled).toBe(true);
    expect(wizardWithHook.getCurrent().ctx.count).toBe(100);
  });
});

describe('createZodValidator', () => {
  it('should create a working validator', () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().min(18),
    });
    
    const validator = createZodValidator(schema);
    
    // Valid data should not throw
    expect(() => validator({ email: 'test@example.com', age: 25 }, {}))
      .not.toThrow();
    
    // Invalid data should throw
    expect(() => validator({ email: 'invalid', age: 25 }, {}))
      .toThrow();
    
    expect(() => validator({ email: 'test@example.com', age: 17 }, {}))
      .toThrow();
  });
});