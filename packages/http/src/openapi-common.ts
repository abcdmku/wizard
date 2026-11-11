import type { RunStatus, StepPhase, StepStatus } from '@openwizard/core'
import { refTo } from './json-schema'
import type { JSONSchema } from './openapi-types'

// Keyed by core's unions: a status core adds or removes is a compile error here, never drift.
const RUN_STATUS = {
  idle: 0,
  running: 0,
  waiting: 0,
  halted: 0,
  done: 0,
  failed: 0,
  compensating: 0,
  cancelled: 0,
} as const satisfies Record<RunStatus, 0>
const STEP_STATUS = {
  idle: 0,
  active: 0,
  done: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
  compensating: 0,
  compensated: 0,
} as const satisfies Record<StepStatus, 0>
const STEP_PHASE = {
  blocked: 0,
  ready: 0,
  entering: 0,
  validating: 0,
  running: 0,
  retrying: 0,
  waiting: 0,
  exiting: 0,
  compensating: 0,
} as const satisfies Record<StepPhase, 0>

/** Component schemas every OpenWizard API shares, independent of the flow. */
export const COMMON_SCHEMAS: { readonly [name: string]: JSONSchema } = {
  Error: {
    type: 'object',
    description: 'Error body of every OpenWizard route.',
    required: ['ok', 'code', 'message'],
    properties: {
      ok: { type: 'boolean', enum: [false] },
      code: {
        type: 'string',
        description:
          'Stable machine-readable code, such as INSUFFICIENT_SCOPE, IDEMPOTENCY_CONFLICT or BOUNDARY_REJECTED.',
      },
      message: { type: 'string', description: 'Human-readable explanation.' },
      issues: {
        type: 'array',
        description: 'Validation problems, when a schema rejected the input.',
        items: refTo('Issue'),
      },
      requiredScopes: {
        type: 'array',
        description: 'Scopes the caller needed (403 responses).',
        items: { type: 'string' },
      },
    },
  },
  Issue: {
    type: 'object',
    description: 'One validation problem.',
    required: ['message'],
    properties: {
      message: { type: 'string' },
      path: {
        type: 'array',
        description: 'Location of the problem inside the input.',
        items: { oneOf: [{ type: 'string' }, { type: 'integer' }] },
      },
    },
  },
  RunStatus: {
    type: 'string',
    description:
      'Lifecycle status of a run. `halted` is recoverable; done, failed and cancelled are final.',
    enum: Object.keys(RUN_STATUS),
  },
  StepStatus: {
    type: 'string',
    description: 'Lifecycle status of a step.',
    enum: Object.keys(STEP_STATUS),
  },
  StepPhase: {
    type: 'string',
    description: 'Live phase of an active or ready step.',
    enum: Object.keys(STEP_PHASE),
  },
  Progress: {
    type: 'object',
    required: ['done', 'total', 'ratio'],
    properties: {
      done: { type: 'integer', minimum: 0 },
      total: { type: 'integer', minimum: 0 },
      ratio: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  StepError: {
    type: 'object',
    description: 'A step failure without its stack. `data` is the step `mapError` value.',
    required: ['name', 'message'],
    properties: {
      name: { type: 'string' },
      message: { type: 'string' },
      code: { type: 'string' },
      data: { description: 'Value returned by the step mapError hook.' },
    },
  },
  ChildSummary: {
    type: 'object',
    description: 'Compact state of a nested run.',
    required: ['status', 'current', 'progress', 'seq'],
    properties: {
      status: refTo('RunStatus'),
      current: { type: ['string', 'null'], description: 'Current view id of the nested run.' },
      progress: { type: 'number', minimum: 0, maximum: 1 },
      seq: { type: 'integer' },
    },
  },
  CommandAccepted: {
    type: 'object',
    required: ['seq'],
    properties: {
      seq: { type: 'integer', description: 'Run sequence number after the command.' },
    },
  },
  CommandResponse: envelope('The command was applied.', refTo('CommandAccepted')),
  EventAccepted: {
    type: 'object',
    required: ['delivered', 'buffered', 'seq'],
    properties: {
      delivered: {
        type: 'array',
        description: 'Steps that received the event.',
        items: { type: 'string' },
      },
      buffered: {
        type: 'boolean',
        description: 'The event waits in the run inbox for a listener.',
      },
      seq: { type: 'integer', description: 'Run sequence number after the event.' },
      duplicate: {
        type: 'boolean',
        enum: [true],
        description:
          'The run had already accepted an event with this id; nothing was delivered again.',
      },
    },
  },
  EventResponse: envelope('The run accepted the event.', refTo('EventAccepted')),
}

/** `{ ok: true, data }`: the success envelope of every JSON route. */
export function envelope(description: string, data: JSONSchema): JSONSchema {
  return {
    type: 'object',
    description,
    required: ['ok', 'data'],
    properties: { ok: { type: 'boolean', enum: [true] }, data },
  }
}

/** A JSON response object whose body is a component `$ref`. */
export function jsonResponse(description: string, schema: string): JSONSchema {
  return { description, content: { 'application/json': { schema: refTo(schema) } } }
}

/** Error responses by status, all sharing the `Error` schema. */
export function errorResponses(descriptions: { readonly [status: number]: string }): {
  readonly [status: string]: JSONSchema
} {
  return Object.fromEntries(
    Object.entries(descriptions).map(([status, description]) => [
      status,
      jsonResponse(description, 'Error'),
    ]),
  )
}

export function jsonBody(schema: string, description?: string): JSONSchema {
  return {
    required: true,
    ...(description === undefined ? {} : { description }),
    content: { 'application/json': { schema: refTo(schema) } },
  }
}

export function pathParameter(
  name: string,
  description: string,
  values?: readonly string[],
): JSONSchema {
  return {
    in: 'path',
    name,
    required: true,
    description,
    schema: { type: 'string', minLength: 1, ...(values === undefined ? {} : { enum: values }) },
  }
}

export function headerParameter(name: string, description: string, required: boolean): JSONSchema {
  return { in: 'header', name, required, description, schema: { type: 'string', minLength: 1 } }
}
