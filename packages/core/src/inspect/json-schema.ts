/**
 * `toJSONSchema(schema, side)` — JSON Schema (draft 2020-12) of a boundary through the Standard
 * JSON Schema interface (`'~standard'.jsonSchema`).
 *
 * @packageDocumentation
 */

import type { Boundary } from '@openwizard/core'
import type { StandardJSONSchemaV1 } from '@standard-schema/spec'
import type { JSONSchema } from './types'

/**
 * JSON Schema (draft 2020-12) of one side of a boundary: `'input'` is what callers send (a
 * view draft, an event payload, the initial context), `'output'` what hooks see after parsing.
 * `undefined` when the vendor has no Standard JSON Schema converter (Zod 4 and ArkType have one;
 * checkers and Valibot do not) or cannot represent that side (a Zod `.transform()` output).
 * @public
 */
export function toJSONSchema(
  schema: Boundary<unknown, unknown>,
  side: 'input' | 'output',
): JSONSchema | undefined {
  if (!('~standard' in schema)) return undefined
  const props = schema['~standard']
  if (!('jsonSchema' in props) || !isConverter(props.jsonSchema)) return undefined
  try {
    return props.jsonSchema[side]({ target: 'draft-2020-12' })
  } catch {
    return undefined
  }
}

function isConverter(value: unknown): value is StandardJSONSchemaV1.Converter {
  return (
    typeof value === 'object' &&
    value !== null &&
    'input' in value &&
    typeof value.input === 'function' &&
    'output' in value &&
    typeof value.output === 'function'
  )
}
