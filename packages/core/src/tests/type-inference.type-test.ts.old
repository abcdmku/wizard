/**
 * TypeScript type tests for type inference
 * This file is used to verify that TypeScript correctly infers types.
 * It won't be executed, but TypeScript will check it during compilation.
 */

import { z } from 'zod';
import { createWizard } from '../wizard';
import type { InferSteps, InferDataMap, InferContext } from '../types';

// Test: Basic inference from configuration
const basicConfig = {
  initialStep: 'first' as const,
  initialContext: { userId: '123' },
  steps: {
    first: { next: ['second'] as const },
    second: { next: ['third'] as const },
    third: { next: [] as const },
  },
} as const;

type BasicSteps = InferSteps<typeof basicConfig>;
type BasicContext = InferContext<typeof basicConfig>;
type BasicData = InferDataMap<typeof basicConfig>;

// These should be valid type assertions
const _basicSteps: BasicSteps = 'first'; // Should accept 'first' | 'second' | 'third'
const _basicContext: BasicContext = { userId: '123' };
const _basicData: BasicData = { first: undefined, second: undefined, third: undefined };

// Use variables to avoid unused warnings
void _basicSteps;
void _basicContext;
void _basicData;

// Test: Inference with Zod validators
const zodSchema = z.object({
  name: z.string(),
  age: z.number(),
});

const configWithZod = {
  initialStep: 'info',
  initialContext: { sessionId: 'abc' },
  steps: {
    info: {
      next: ['confirm'],
      validate: zodSchema.parse,
    },
    confirm: {
      next: [],
      validate: (_data: unknown): _data is { confirmed: boolean } => true,
    },
  },
} as const;

type ZodSteps = InferSteps<typeof configWithZod>;
type ZodData = InferDataMap<typeof configWithZod>;

// Use types to avoid unused warnings
void ('' as ZodSteps);
void ({} as ZodData);

// Test inferred wizard instance
const inferredWizard = createWizard({
  initialStep: 'step1',
  initialContext: { test: true },
  steps: {
    step1: {
      next: ['step2'],
      validate: z.object({ field1: z.string() }).parse,
    },
    step2: {
      next: [],
      load: () => ({ field2: 42 }),
    },
  },
});

// These operations should be type-safe
inferredWizard.setStepData('step1', { field1: 'value' });
inferredWizard.setStepData('step2', { field2: 42 });

const step1Data = inferredWizard.getStepData('step1');
const step2Data = inferredWizard.getStepData('step2');

// Use variables to avoid unused warnings
void step1Data;
void step2Data;

// Test with explicit types (backward compatibility)
type ExplicitContext = { explicitCtx: string };
type ExplicitSteps = 'a' | 'b' | 'c';
type ExplicitData = {
  a: { aField: string };
  b: { bField: number };
  c: { cField: boolean };
};

const explicitWizard = createWizard<ExplicitContext, ExplicitSteps, ExplicitData>({
  initialStep: 'a',
  initialContext: { explicitCtx: 'test' },
  steps: {
    a: { next: ['b'] },
    b: { next: ['c'] },
    c: { next: [] },
  },
});

// These should be properly typed
const aData: ExplicitData['a'] | undefined = explicitWizard.getStepData('a');
const bData: ExplicitData['b'] | undefined = explicitWizard.getStepData('b');
const cData: ExplicitData['c'] | undefined = explicitWizard.getStepData('c');

// Use variables to avoid unused warnings
void aData;
void bData;
void cData;

// Test: Complex nested inference
const complexConfig = {
  initialStep: 'nested',
  initialContext: {
    user: {
      id: '123',
      profile: {
        name: 'Test',
        settings: { theme: 'dark' },
      },
    },
  },
  steps: {
    nested: {
      next: [],
      validate: z.object({
        deeply: z.object({
          nested: z.object({
            value: z.array(z.string()),
          }),
        }),
      }).parse,
    },
  },
} as const;

const complexWizard = createWizard(complexConfig);
complexWizard.setStepData('nested', {
  deeply: {
    nested: {
      value: ['item1', 'item2'],
    },
  },
});

// Test: Mixed validator patterns
const mixedWizard = createWizard({
  initialStep: 'mixed1',
  steps: {
    mixed1: {
      next: ['mixed2'],
      validate: (_data: unknown): asserts _data is { type: 'assertion' } => {
        if (!_data || typeof _data !== 'object') throw new Error('Invalid');
      },
    },
    mixed2: {
      next: ['mixed3'],
      validate: z.object({ type: z.literal('zod') }).parse,
    },
    mixed3: {
      next: ['mixed4'],
      validate: (_data: unknown): _data is { type: 'guard' } => {
        return typeof _data === 'object' && _data !== null && 'type' in _data;
      },
    },
    mixed4: {
      next: [],
      load: () => ({ type: 'loaded' as const }),
    },
  },
});

// Each step should have properly inferred data types
mixedWizard.setStepData('mixed1', { type: 'assertion' });
mixedWizard.setStepData('mixed2', { type: 'zod' });
mixedWizard.setStepData('mixed3', { type: 'guard' });
mixedWizard.setStepData('mixed4', { type: 'loaded' });

// Test: Async load function inference
const asyncWizard = createWizard({
  initialStep: 'async',
  steps: {
    async: {
      next: [],
      load: async () => {
        // Simulate async operation
        await Promise.resolve();
        return {
          loaded: true,
          timestamp: Date.now(),
          data: [1, 2, 3],
        };
      },
    },
  },
});

const asyncData = asyncWizard.getStepData('async');
// TypeScript should know asyncData might be undefined or have the shape from load
void asyncData;

// Test: Empty/minimal configuration
const minimalWizard = createWizard({
  initialStep: 'only',
  steps: {
    only: { next: [] },
  },
});

// This should work even with minimal config
minimalWizard.setStepData('only', { anything: 'goes' });

// Export to prevent unused variable errors
export {
  basicConfig,
  configWithZod,
  inferredWizard,
  explicitWizard,
  complexWizard,
  mixedWizard,
  asyncWizard,
  minimalWizard,
};