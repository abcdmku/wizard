/**
 * Optional Zod validation adapter for @wizard/core
 * This is a separate entry point to avoid hard dependency on Zod
 */

import type { z } from 'zod';

/**
 * Creates a validation function from a Zod schema
 * @param schema - Zod schema to use for validation
 * @returns Validation function that asserts data matches the schema
 */
export function createZodValidator<T>(
  schema: z.ZodSchema<T>
): (data: unknown, ctx: unknown) => asserts data is T {
  return (data: unknown, _ctx: unknown): asserts data is T => {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw result.error;
    }
  };
}

/**
 * Creates a context-aware validation function from a Zod schema factory
 * @param schemaFactory - Function that creates a Zod schema based on context
 * @returns Validation function that asserts data matches the schema
 */
export function createContextualZodValidator<T, C>(
  schemaFactory: (ctx: Readonly<C>) => z.ZodSchema<T>
): (data: unknown, ctx: Readonly<C>) => asserts data is T {
  return (data: unknown, ctx: Readonly<C>): asserts data is T => {
    const schema = schemaFactory(ctx);
    const result = schema.safeParse(data);
    if (!result.success) {
      throw result.error;
    }
  };
}

/**
 * Helper to extract inferred type from a Zod schema
 * Useful for defining step data types
 */
export type InferSchema<T> = T extends z.ZodSchema<infer U> ? U : never;