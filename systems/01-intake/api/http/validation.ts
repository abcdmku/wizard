import { z } from 'zod'
import { ApplicationIdSchema } from '../../shared/common.js'
import { IntakeHttpError, zodIssues } from './errors.js'

export const ApplicationParamsSchema = z.object({ id: ApplicationIdSchema }).strict()

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new IntakeHttpError({
    code: 'INVALID_REQUEST',
    issues: zodIssues(parsed.error),
    message: 'Request validation failed',
    statusCode: 400,
  })
}
