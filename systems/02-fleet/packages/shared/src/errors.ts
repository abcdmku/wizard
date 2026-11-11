import { Schema } from 'effect'
import { HttpApiSchema } from 'effect/unstable/httpapi'

const fields = {
  code: Schema.String,
  message: Schema.String,
  requestId: Schema.optional(Schema.String),
}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  'UnauthorizedError',
  fields,
) {}
export const UnauthorizedErrorSchema = UnauthorizedError.pipe(HttpApiSchema.status('Unauthorized'))

export class ForbiddenError extends Schema.TaggedError<ForbiddenError>()(
  'ForbiddenError',
  fields,
) {}
export const ForbiddenErrorSchema = ForbiddenError.pipe(HttpApiSchema.status('Forbidden'))

export class CrossTenantError extends Schema.TaggedError<CrossTenantError>()(
  'CrossTenantError',
  fields,
) {}
export const CrossTenantErrorSchema = CrossTenantError.pipe(HttpApiSchema.status('Forbidden'))

export class MalformedRequestError extends Schema.TaggedError<MalformedRequestError>()(
  'MalformedRequestError',
  fields,
) {}
export const MalformedRequestErrorSchema = MalformedRequestError.pipe(
  HttpApiSchema.status('BadRequest'),
)

export class DeliveryNotFoundError extends Schema.TaggedError<DeliveryNotFoundError>()(
  'DeliveryNotFoundError',
  fields,
) {}
export const DeliveryNotFoundErrorSchema = DeliveryNotFoundError.pipe(
  HttpApiSchema.status('NotFound'),
)

export class CommandConflictError extends Schema.TaggedError<CommandConflictError>()(
  'CommandConflictError',
  fields,
) {}
export const CommandConflictErrorSchema = CommandConflictError.pipe(
  HttpApiSchema.status('Conflict'),
)

export class PersistenceError extends Schema.TaggedError<PersistenceError>()(
  'PersistenceError',
  fields,
) {}
export const PersistenceErrorSchema = PersistenceError.pipe(
  HttpApiSchema.status('ServiceUnavailable'),
)

export const FleetApiErrorSchemas = [
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  CrossTenantErrorSchema,
  MalformedRequestErrorSchema,
  DeliveryNotFoundErrorSchema,
  CommandConflictErrorSchema,
  PersistenceErrorSchema,
] as const

export type FleetApiError =
  | UnauthorizedError
  | ForbiddenError
  | CrossTenantError
  | MalformedRequestError
  | DeliveryNotFoundError
  | CommandConflictError
  | PersistenceError
