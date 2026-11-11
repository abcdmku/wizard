import type { AnyWizard } from '@openwizard/core'
import { toJSONSchema } from '@openwizard/core/inspect'
import {
  FLOW_COMMAND_TYPES,
  type FlowCommandType,
  STEP_COMMAND_TYPES,
  type StepCommandType,
} from './access'
import { partialSchema } from './json-schema'
import { pascalCase } from './naming'
import { type FlowDocs, registerDraft } from './openapi-flow'
import type { JSONSchema } from './openapi-types'

const DESCRIPTIONS: { readonly [K in FlowCommandType | StepCommandType]: string } = {
  start: 'Activate the start step(s).',
  next: 'Validate the current view and move forward.',
  back: 'Return to the previous view (its draft is kept).',
  startReady: 'Start ready steps of a manual flow.',
  cancel: 'Cancel the run.',
  compensate: 'Run compensation hooks in reverse order.',
  reset: 'Return the run to its initial state.',
  go: 'Move to a ready view.',
  invalidate: 'Return a finished step (and its dependents) to idle.',
  resetInput: "Clear a view's draft input.",
  retry: 'Re-run a failed step.',
  startStep: 'Start one ready step now.',
  setInput: "Merge a patch into a view's draft input.",
  skip: 'Skip a step; it counts as done for its dependents.',
  child: 'Send a command to a nested run.',
}

/** Commands exposed by one API. */
export interface CommandSelection {
  readonly flow: ReadonlySet<FlowCommandType>
  readonly steps: ReadonlyMap<string, ReadonlySet<StepCommandType>>
}

/**
 * Register one named variant per exposed command type and the `<Prefix>Command` union over
 * them, discriminated by `type`.
 */
export function registerCommands(docs: FlowDocs<AnyWizard>, selection: CommandSelection): void {
  const mapping: Record<string, string> = {}
  const add = (type: FlowCommandType | StepCommandType, fields: CommandFields) => {
    const name = `${docs.names.prefix}${pascalCase(type)}Command`
    docs.registry.ref(name, commandObject(type, fields))
    mapping[type] = `#/components/schemas/${name}`
  }
  for (const type of FLOW_COMMAND_TYPES) {
    if (selection.flow.has(type)) add(type, flowCommandFields(type, [...docs.steps.keys()]))
  }
  for (const type of STEP_COMMAND_TYPES) {
    const steps = [...selection.steps].filter(([, types]) => types.has(type)).map(([step]) => step)
    if (steps.length > 0) add(type, stepCommandFields(docs, type, steps))
  }
  docs.registry.ref(docs.names.command, {
    description: `A command for a run of ${docs.flow.name}, selected by \`type\`.`,
    oneOf: Object.values(mapping).map(($ref) => ({ $ref })),
    discriminator: { propertyName: 'type', mapping },
  })
}

interface CommandFields {
  readonly properties: { readonly [name: string]: JSONSchema }
  readonly required: readonly string[]
}

function flowCommandFields(type: FlowCommandType, steps: readonly string[]): CommandFields {
  const reason = { type: 'string', description: 'Recorded with the command.' }
  if (type === 'cancel') return { properties: { reason }, required: [] }
  if (type === 'compensate') {
    return {
      properties: {
        from: { type: 'string', enum: steps, description: 'Compensate from this step back.' },
        reason,
      },
      required: [],
    }
  }
  return { properties: {}, required: [] }
}

function stepCommandFields(
  docs: FlowDocs<AnyWizard>,
  type: StepCommandType,
  steps: readonly string[],
): CommandFields {
  if (type === 'child') {
    return {
      properties: {
        path: {
          type: 'array',
          description: `Flow step ids from this run down to the target run; the first is one of: ${steps.join(', ')}.`,
          items: { type: 'string' },
          minItems: 1,
          maxItems: 8,
        },
        command: { type: 'object', description: 'The command for the nested run.' },
      },
      required: ['path', 'command'],
    }
  }
  const step = { type: 'string', enum: steps }
  if (type === 'setInput') {
    const drafts = steps.map((view) => registerDraft(docs, view))
    return {
      properties: { step, patch: drafts.length === 1 ? (drafts[0] ?? {}) : { anyOf: drafts } },
      required: ['step', 'patch'],
    }
  }
  if (type === 'go' || type === 'skip') {
    return { properties: { step, reason: { type: 'string' } }, required: ['step'] }
  }
  if (type === 'invalidate') {
    return {
      properties: {
        step,
        cascade: { type: 'boolean', description: 'Also invalidate dependents. Defaults to true.' },
      },
      required: ['step'],
    }
  }
  if (type === 'retry') {
    return {
      properties: {
        step,
        patch: {
          ...partialSchema(toJSONSchema(docs.flow.context, 'output') ?? {}),
          description: 'Context values applied before retrying the failed step.',
        },
      },
      required: ['step'],
    }
  }
  return { properties: { step }, required: ['step'] }
}

function commandObject(type: FlowCommandType | StepCommandType, fields: CommandFields): JSONSchema {
  return {
    type: 'object',
    description: DESCRIPTIONS[type],
    required: ['type', ...fields.required],
    properties: { type: { type: 'string', enum: [type] }, ...fields.properties },
    additionalProperties: false,
  }
}
