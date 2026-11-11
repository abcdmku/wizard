import { z } from 'zod'
import { ApiErrorSchema, type CommandResponse } from '../../shared/api-contract.js'
import { type ValidationIssue, ValidationIssueSchema } from '../../shared/common.js'

interface IntakeHttpErrorOptions {
  readonly code: string
  readonly issues?: readonly ValidationIssue[]
  readonly message: string
  readonly statusCode: number
}

export class IntakeHttpError extends Error {
  readonly code: string
  readonly issues?: readonly ValidationIssue[]
  readonly statusCode: number

  constructor(options: IntakeHttpErrorOptions) {
    super(options.message)
    this.name = 'IntakeHttpError'
    this.code = options.code
    this.statusCode = options.statusCode
    if (options.issues !== undefined) this.issues = options.issues
  }
}

const conflictCodes = new Set([
  'CAS_CONFLICT',
  'COMMAND_PENDING',
  'COMMAND_INTERRUPTED',
  'DEDUPLICATE_CONFLICT',
  'FLOW_COMPENSATING',
  'STALE',
  'STALE_VERSION',
])
const notFoundCodes = new Set(['APPLICATION_NOT_FOUND', 'NOT_FOUND', 'RUN_NOT_FOUND'])
const unavailableCodes = new Set(['LEASE_BUSY', 'LEASE_LOST'])

export function statusForCode(code: string, fallback = 400): number {
  if (code === 'FORBIDDEN') return 403
  if (code === 'UNAUTHORIZED') return 401
  if (notFoundCodes.has(code)) return 404
  if (conflictCodes.has(code)) return 409
  if (unavailableCodes.has(code)) return 503
  return fallback
}

export function statusForCommand(response: CommandResponse): number {
  return response.ok ? 200 : statusForCode(response.code)
}

function propertyCode(error: object): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function propertyMessage(error: object): string | undefined {
  return 'message' in error && typeof error.message === 'string' ? error.message : undefined
}

function propertyStatus(error: object): number | undefined {
  if (!('statusCode' in error) || typeof error.statusCode !== 'number') return undefined
  return error.statusCode >= 400 && error.statusCode <= 599 ? error.statusCode : undefined
}

function propertyIssues(error: object): readonly ValidationIssue[] | undefined {
  if (!('issues' in error)) return undefined
  const parsed = z.array(ValidationIssueSchema).safeParse(error.issues)
  return parsed.success ? parsed.data : undefined
}

export function normalizeHttpError(error: unknown): IntakeHttpError {
  if (error instanceof IntakeHttpError) return error
  if (error instanceof z.ZodError) {
    return new IntakeHttpError({
      code: 'INVALID_REQUEST',
      issues: zodIssues(error),
      message: 'Request validation failed',
      statusCode: 400,
    })
  }
  if (typeof error === 'object' && error !== null) {
    const code = propertyCode(error) ?? 'REQUEST_FAILED'
    const statusCode = propertyStatus(error) ?? statusForCode(code, 500)
    const message =
      statusCode >= 500
        ? 'The intake service could not complete the request'
        : (propertyMessage(error) ?? 'Request failed')
    const issues = propertyIssues(error)
    return new IntakeHttpError({
      code,
      ...(issues === undefined ? {} : { issues }),
      message,
      statusCode,
    })
  }
  return new IntakeHttpError({
    code: 'INTERNAL_ERROR',
    message: 'The intake service could not complete the request',
    statusCode: 500,
  })
}

export function errorBody(error: IntakeHttpError) {
  return ApiErrorSchema.parse({
    ok: false,
    code: error.code,
    message: error.message,
    ...(error.issues === undefined ? {} : { issues: error.issues }),
  })
}

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map((part) =>
      typeof part === 'symbol' ? (part.description ?? part.toString()) : part,
    ),
  }))
}
