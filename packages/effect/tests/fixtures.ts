import type { StandardSchemaV1 } from '@standard-schema/spec'

export function schema<A>(
  validate: (value: unknown) => A | undefined,
): StandardSchemaV1<unknown, A> {
  return {
    '~standard': {
      version: 1,
      vendor: 'openwizard-effect-test',
      validate(value) {
        const parsed = validate(value)
        return parsed === undefined
          ? { issues: [{ message: 'invalid test value' }] }
          : { value: parsed }
      },
    },
  }
}

export function asyncSchema<A>(
  validate: (value: unknown) => Promise<A | undefined>,
): StandardSchemaV1<unknown, A> {
  return {
    '~standard': {
      version: 1,
      vendor: 'openwizard-effect-test',
      async validate(value) {
        const parsed = await validate(value)
        return parsed === undefined
          ? { issues: [{ message: 'invalid async test value' }] }
          : { value: parsed }
      },
    },
  }
}

export const outputSchema = schema<{ readonly ok: true }>((value) =>
  typeof value === 'object' && value !== null && 'ok' in value && value.ok === true
    ? { ok: true }
    : undefined,
)

export const failureSchema = schema<{ readonly code: string }>((value) =>
  typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
    ? { code: value.code }
    : undefined,
)
