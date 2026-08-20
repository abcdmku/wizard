import type { AnyFlow } from '@openwizard/core'

export const FLOW_COMMAND_TYPES = [
  'start',
  'next',
  'back',
  'runReady',
  'cancel',
  'compensate',
  'reset',
] as const

export const STEP_COMMAND_TYPES = [
  'go',
  'invalidate',
  'resetInput',
  'retry',
  'run',
  'setInput',
  'skip',
  'child',
] as const

export type FlowCommandType = (typeof FLOW_COMMAND_TYPES)[number]
export type StepCommandType = (typeof STEP_COMMAND_TYPES)[number]

export interface CommandSchemaSelection {
  readonly flow: ReadonlySet<FlowCommandType>
  readonly steps: ReadonlyMap<string, ReadonlySet<StepCommandType>>
  readonly events: ReadonlySet<string>
}

export function createCommandSchema(
  flow: AnyFlow,
  selection: CommandSchemaSelection = fullSelection(flow),
): Readonly<Record<string, unknown>> {
  const oneOf: Readonly<Record<string, unknown>>[] = []
  for (const command of FLOW_COMMAND_TYPES) {
    if (selection.flow.has(command)) {
      oneOf.push(flowCommandSchema(command, Object.keys(flow.steps)))
    }
  }
  for (const command of STEP_COMMAND_TYPES.filter((value) => value !== 'child')) {
    const steps = [...selection.steps]
      .filter(([, commands]) => commands.has(command))
      .map(([step]) => step)
    if (steps.length > 0) oneOf.push(stepCommandSchema(command, steps))
  }
  if (selection.events.size > 0) {
    oneOf.push(
      commandObject(
        'send',
        {
          event: { type: 'string', enum: [...selection.events] },
          payload: {},
          correlationId: { type: 'string' },
        },
        ['event', 'payload'],
      ),
    )
  }
  const childSteps = [...selection.steps]
    .filter(([, commands]) => commands.has('child'))
    .map(([step]) => step)
  if (childSteps.length > 0) {
    oneOf.push(
      commandObject(
        'child',
        {
          path: {
            type: 'array',
            prefixItems: [{ type: 'string', enum: childSteps }],
            items: { type: 'string' },
            minItems: 1,
            maxItems: 8,
          },
          command: { type: 'object' },
        },
        ['path', 'command'],
      ),
    )
  }
  return { oneOf }
}

export function stepCommandsForKind(kind: string | undefined): readonly StepCommandType[] {
  return [
    'invalidate',
    'skip',
    ...(kind === 'view' ? (['go', 'resetInput', 'setInput'] as const) : []),
    ...(kind === 'task' ? (['retry', 'run'] as const) : []),
    ...(kind === 'flow' ? (['child'] as const) : []),
  ]
}

function fullSelection(flow: AnyFlow): CommandSchemaSelection {
  const steps = new Map<string, ReadonlySet<StepCommandType>>()
  for (const [step, definition] of Object.entries(flow.steps)) {
    steps.set(step, new Set(stepCommandsForKind(definition.kind)))
  }
  return {
    flow: new Set(FLOW_COMMAND_TYPES),
    steps,
    events: new Set(Object.keys(flow.events ?? {})),
  }
}

function flowCommandSchema(
  type: FlowCommandType,
  steps: readonly string[],
): Readonly<Record<string, unknown>> {
  if (type === 'cancel') return commandObject(type, { reason: { type: 'string' } })
  if (type === 'compensate') {
    return commandObject(type, {
      from: { type: 'string', enum: steps },
      reason: { type: 'string' },
    })
  }
  return commandObject(type)
}

function stepCommandSchema(
  type: Exclude<StepCommandType, 'child'>,
  steps: readonly string[],
): Readonly<Record<string, unknown>> {
  const extra =
    type === 'go' || type === 'skip'
      ? { reason: { type: 'string' } }
      : type === 'setInput'
        ? { patch: {} }
        : type === 'invalidate'
          ? { cascade: { type: 'boolean' } }
          : {}
  return commandObject(type, { step: { type: 'string', enum: steps }, ...extra }, [
    'step',
    ...(type === 'setInput' ? ['patch'] : []),
  ])
}

function commandObject(
  type: string,
  properties: Readonly<Record<string, unknown>> = {},
  required: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: { type: { const: type }, ...properties },
    required: ['type', ...required],
    additionalProperties: false,
  }
}
