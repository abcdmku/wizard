/**
 * Optional Zod validation adapter for @wizard/core
 * This is a separate entry point to avoid hard dependency on Zod
 */
/**
 * Creates a validation function from a Zod schema
 * @param schema - Zod schema to use for validation
 * @returns Validation function that asserts data matches the schema
 */
export function createZodValidator(schema) {
    return (data, _ctx) => {
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
export function createContextualZodValidator(schemaFactory) {
    return (data, ctx) => {
        const schema = schemaFactory(ctx);
        const result = schema.safeParse(data);
        if (!result.success) {
            throw result.error;
        }
    };
}
