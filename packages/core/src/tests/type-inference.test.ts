import { describe, it, expect, beforeEach, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { createWizard } from '../wizard';
import type { Wizard } from '../types';

describe('Type Inference', () => {
  describe('Explicit Types (backward compatibility)', () => {
    type Context = { userId: string };
    type Steps = 'info' | 'payment' | 'confirm';
    type Data = {
      info: { name: string; email: string };
      payment: { method: string; amount: number };
      confirm: { agreed: boolean };
    };

    it('should work with explicit type parameters', () => {
      const wizard = createWizard<Context, Steps, Data>({
        initialStep: 'info',
        initialContext: { userId: '123' },
        steps: {
          info: {
            next: ['payment'],
            validate: (data): asserts data is Data['info'] => {
              if (!data || typeof data !== 'object') throw new Error('Invalid data');
            },
          },
          payment: {
            next: ['confirm'],
            validate: (data): asserts data is Data['payment'] => {
              if (!data || typeof data !== 'object') throw new Error('Invalid data');
            },
          },
          confirm: {
            next: [],
            validate: (data): asserts data is Data['confirm'] => {
              if (!data || typeof data !== 'object') throw new Error('Invalid data');
            },
          },
        },
      });

      expect(wizard).toBeDefined();
      expect(wizard.store.state.step).toBe('info');
      expect(wizard.store.state.context).toEqual({ userId: '123' });
    });
  });

  describe('Inferred Types', () => {
    const paymentSchema = z.object({
      method: z.string(),
      amount: z.number().positive(),
    });

    type InfoData = { name: string; email: string };

    it('should infer types from validator functions', () => {
      const wizard = createWizard({
        initialStep: 'info',
        initialContext: { userId: '456' },
        steps: {
          info: {
            next: ['payment'],
            load: () => ({ name: '', email: '' } as InfoData),
          },
          payment: {
            next: ['confirm'],
            validate: paymentSchema.parse,
          },
          confirm: {
            next: [],
            validate: (data): data is { agreed: boolean } => {
              return typeof data === 'object' && data !== null && 'agreed' in data;
            },
          },
        },
      });

      expect(wizard).toBeDefined();
      expect(wizard.store.state.step).toBe('info');

      // Test that getStepData works with inferred types
      const infoData = wizard.getStepData('info');
      expect(infoData).toBeUndefined(); // No data set yet

      // Set some data and retrieve it
      wizard.setStepData('info', { name: 'John', email: 'john@example.com' });
      const updatedInfoData = wizard.getStepData('info');
      expect(updatedInfoData).toEqual({ name: 'John', email: 'john@example.com' });
    });

    it('should infer types from Zod schemas', () => {
      const userSchema = z.object({
        firstName: z.string(),
        lastName: z.string(),
        age: z.number().min(18),
      });

      const addressSchema = z.object({
        street: z.string(),
        city: z.string(),
        zip: z.string(),
      });

      const wizard = createWizard({
        initialStep: 'user',
        initialContext: {},
        steps: {
          user: {
            next: ['address'],
            validate: userSchema.parse,
          },
          address: {
            next: ['review'],
            validate: addressSchema.parse,
          },
          review: {
            next: [],
          },
        },
      });

      expect(wizard).toBeDefined();

      // Test validation with Zod schema
      const validUserData = {
        firstName: 'Jane',
        lastName: 'Doe',
        age: 25,
      };

      wizard.setStepData('user', validUserData);
      const userData = wizard.getStepData('user');
      expect(userData).toEqual(validUserData);
    });

    it('should infer types from load functions', () => {
      const wizard = createWizard({
        initialStep: 'loading',
        initialContext: { loading: false },
        steps: {
          loading: {
            next: ['loaded'],
            load: async () => {
              // Simulate async data loading
              return { data: 'loaded', timestamp: Date.now() };
            },
          },
          loaded: {
            next: [],
          },
        },
      });

      expect(wizard).toBeDefined();
      expect(wizard.store.state.step).toBe('loading');
    });

    it('should support mixed validator patterns', () => {
      const zodSchema = z.object({ zodField: z.string() });

      const wizard = createWizard({
        initialStep: 'mixed',
        initialContext: {},
        steps: {
          mixed: {
            next: ['typeGuard', 'zodParse', 'traditional'],
          },
          typeGuard: {
            next: [],
            validate: (data): data is { guarded: true } => {
              return data && typeof data === 'object' && 'guarded' in data;
            },
          },
          zodParse: {
            next: [],
            validate: zodSchema.parse,
          },
          traditional: {
            next: [],
            validate: (data, ctx) => {
              if (!data) throw new Error('Data required');
            },
          },
        },
      });

      expect(wizard).toBeDefined();
    });

    it('should handle safeParse from Zod', () => {
      const safeSchema = z.object({
        safeField: z.string().email(),
      });

      const wizard = createWizard({
        initialStep: 'safe',
        initialContext: {},
        steps: {
          safe: {
            next: [],
            validate: safeSchema,
          },
        },
      });

      expect(wizard).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('should provide proper type safety for step data', () => {
      const schema = z.object({
        value: z.number(),
      });

      const wizard = createWizard({
        initialStep: 'typed',
        initialContext: { test: true },
        steps: {
          typed: {
            next: [],
            validate: schema.parse,
          },
        },
      });

      // This should be type-safe
      wizard.setStepData('typed', { value: 42 });

      const data = wizard.getStepData('typed');
      expect(data).toEqual({ value: 42 });

      // TypeScript should know the shape of data
      if (data) {
        expect(data.value).toBe(42);
      }
    });

    it('direct parse validators infer data types', () => {
      const paymentSchema = z.object({
        method: z.enum(['card', 'paypal']),
        amount: z.number().positive(),
      });

      const wizard = createWizard({
        initialStep: 'info',
        initialContext: { userId: '123' },
        steps: {
          info: {
            next: ['payment'],
          },
          payment: {
            next: [],
            validate: paymentSchema.parse,
          },
        },
      });

      expectTypeOf(wizard.getStepData('payment')).toEqualTypeOf<{ method: 'card' | 'paypal'; amount: number } | undefined>();
    });

    it('should handle complex nested types', () => {
      const complexSchema = z.object({
        user: z.object({
          profile: z.object({
            name: z.string(),
            settings: z.array(z.object({
              key: z.string(),
              value: z.unknown(),
            })),
          }),
        }),
      });

      const wizard = createWizard({
        initialStep: 'complex',
        initialContext: {},
        steps: {
          complex: {
            next: [],
            validate: complexSchema.parse,
          },
        },
      });

      const complexData = {
        user: {
          profile: {
            name: 'Test User',
            settings: [
              { key: 'theme', value: 'dark' },
              { key: 'notifications', value: true },
            ],
          },
        },
      };

      wizard.setStepData('complex', complexData);
      expect(wizard.getStepData('complex')).toEqual(complexData);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty configuration', () => {
      const wizard = createWizard({
        initialStep: 'only',
        steps: {
          only: {
            next: [],
          },
        },
      });

      expect(wizard).toBeDefined();
      expect(wizard.store.state.context).toEqual({});
    });

    it('should handle validators that throw errors', () => {
      const wizard = createWizard({
        initialStep: 'error',
        initialContext: {},
        steps: {
          error: {
            next: [],
            validate: () => {
              throw new Error('Validation error');
            },
          },
        },
      });

      expect(wizard).toBeDefined();

      // Validation should handle errors gracefully
      wizard.setStepData('error', { test: 'data' });
      // The wizard should still function even if validation would fail
      expect(wizard.store.state.step).toBe('error');
    });
  });
});
