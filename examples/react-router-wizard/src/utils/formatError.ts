import { ZodError } from 'zod';

export function formatError(error: unknown): string {
  if (error instanceof ZodError) {
    // Get the first error message from Zod validation
    return error.errors[0]?.message || 'Validation failed';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
