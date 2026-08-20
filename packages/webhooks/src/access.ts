import type { AnyFlow, Command, ExposeSpec, StepId } from '@openwizard/core'
import {
  FLOW_COMMAND_TYPES,
  type FlowCommandType,
  STEP_COMMAND_TYPES,
  type StepCommandType,
  stepCommandsForKind,
} from './command-openapi'
import type { FlowAccess, HTTPAccess } from './http-options'

type StepCapability =
  | 'child'
  | 'error'
  | 'go'
  | 'input'
  | 'invalidate'
  | 'issues'
  | 'output'
  | 'read'
  | 'resetInput'
  | 'retry'
  | 'run'
  | 'setInput'
  | 'skip'
  | 'summary'

const STEP_READS = ['read', 'input', 'output', 'issues', 'error', 'summary'] as const
const FLOW_CAPABILITIES = [
  'read',
  'output',
  'progress',
  ...FLOW_COMMAND_TYPES,
] as const satisfies readonly FlowAccess[]

export interface AccessPlan<F extends AnyFlow> {
  readonly readRun: boolean
  readonly readSteps: readonly StepId<F>[]
  readonly expose: ExposeSpec<F>
  readonly flowCommands: ReadonlySet<FlowCommandType>
  readonly stepCommands: ReadonlyMap<string, ReadonlySet<StepCommandType>>
  readonly events: ReadonlySet<string>
  readonly hasCommands: boolean
}

export function planAccess<F extends AnyFlow>(
  flow: F,
  access: true | HTTPAccess<F>,
): AccessPlan<F> {
  return access === true ? fullAccess(flow) : selectedAccess(flow, access)
}

export function commandAllowed<F extends AnyFlow>(
  plan: AccessPlan<F>,
  command: Command<F>,
): boolean {
  if (command.type === 'send') return plan.events.has(command.event)
  if (command.type === 'child') return plan.stepCommands.get(command.path[0])?.has('child') === true
  if ('step' in command) return plan.stepCommands.get(command.step)?.has(command.type) === true
  return plan.flowCommands.has(command.type)
}

function fullAccess<F extends AnyFlow>(flow: F): AccessPlan<F> {
  const readSteps = Object.keys(flow.steps) as StepId<F>[]
  const stepCommands = new Map<string, ReadonlySet<StepCommandType>>()
  for (const step of readSteps) {
    stepCommands.set(step, new Set(stepCommandsForKind(flow.steps[step]?.kind)))
  }
  const plan = {
    readRun: true,
    readSteps,
    expose: exposeAll(flow, readSteps),
    flowCommands: new Set(FLOW_COMMAND_TYPES),
    stepCommands,
    events: new Set(Object.keys(flow.events ?? {})),
    hasCommands: true,
  }
  return plan
}

function selectedAccess<F extends AnyFlow>(flow: F, access: HTTPAccess<F>): AccessPlan<F> {
  if (typeof access !== 'object' || access === null || Array.isArray(access)) {
    throw new TypeError('API access must be true or an object')
  }
  const flowCapabilities = capabilityList(access.flow ?? [], FLOW_CAPABILITIES, 'flow access')
  const flowCommands = new Set(
    flowCapabilities.filter((value): value is FlowCommandType => isFlowCommand(value)),
  )
  const context =
    access.context === undefined ? undefined : stringList(access.context, 'context access')
  const readRun =
    (context?.length ?? 0) > 0 ||
    flowCapabilities.some((value) => value === 'read' || value === 'output' || value === 'progress')
  const readSteps: StepId<F>[] = []
  const stepCommands = new Map<string, ReadonlySet<StepCommandType>>()
  const exposedSteps: Record<string, object> = {}
  const availableSteps = new Set(Object.keys(flow.steps))
  for (const [step, raw] of Object.entries(access.steps ?? {})) {
    if (!availableSteps.has(step))
      throw new TypeError(`HTTP access contains unknown step '${step}'`)
    if (raw === undefined) continue
    const kind = flow.steps[step]?.kind
    const capabilities = capabilityList(raw, capabilitiesForKind(kind), `access for step '${step}'`)
    const reads = capabilities.filter(isStepRead)
    if (reads.length > 0) {
      readSteps.push(step as StepId<F>)
      exposedSteps[step] = stepExpose(kind, reads)
    }
    const commands = capabilities.filter((value): value is StepCommandType => isStepCommand(value))
    if (commands.length > 0) stepCommands.set(step, new Set(commands))
  }
  const events = new Set(selectedEvents(flow, access.events ?? []))
  return {
    readRun,
    readSteps,
    expose: {
      ...(context === undefined ? {} : { context }),
      ...(flowCapabilities.some((value) => value === 'read' || value === 'output')
        ? { output: true }
        : {}),
      ...(flowCapabilities.some((value) => value === 'read' || value === 'progress')
        ? { progress: true }
        : {}),
      steps: exposedSteps,
    } as ExposeSpec<F>,
    flowCommands,
    stepCommands,
    events,
    hasCommands: flowCommands.size > 0 || stepCommands.size > 0 || events.size > 0,
  }
}

function exposeAll<F extends AnyFlow>(flow: F, steps: readonly StepId<F>[]): ExposeSpec<F> {
  const exposedSteps: Record<string, object> = {}
  for (const step of steps) exposedSteps[step] = fullStepExpose(flow.steps[step]?.kind)
  return { steps: exposedSteps, output: true, progress: true } as ExposeSpec<F>
}

function stepExpose(kind: string | undefined, reads: readonly StepCapability[]): object {
  if (reads.includes('read')) return fullStepExpose(kind)
  return {
    ...(reads.includes('input') ? { input: true } : {}),
    ...(reads.includes('output') ? { output: true } : {}),
    ...(reads.includes('issues') ? { issues: true } : {}),
    ...(reads.includes('error') ? { error: true } : {}),
    ...(reads.includes('summary') ? { child: true } : {}),
  }
}

function fullStepExpose(kind: string | undefined): object {
  return {
    ...(kind === 'view' ? { input: true } : {}),
    output: true,
    issues: true,
    error: true,
    ...(kind === 'flow' ? { child: true } : {}),
  }
}

function capabilitiesForKind(kind: string | undefined): readonly StepCapability[] {
  return [
    'read',
    'output',
    'issues',
    'error',
    'invalidate',
    'skip',
    ...(kind === 'view' ? (['input', 'go', 'resetInput', 'setInput'] as const) : []),
    ...(kind === 'task' ? (['retry', 'run'] as const) : []),
    ...(kind === 'flow' ? (['child', 'summary'] as const) : []),
  ]
}

function selectedEvents<F extends AnyFlow>(
  flow: F,
  selected: readonly string[],
): readonly string[] {
  const result = stringList(selected, 'API event access')
  const available = new Set(Object.keys(flow.events ?? {}))
  for (const event of result) {
    if (!available.has(event)) throw new TypeError(`HTTP access contains unknown event '${event}'`)
  }
  return result
}

function capabilityList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): readonly T[] {
  const values = stringList(value, label)
  for (const capability of values) {
    if (!allowed.includes(capability as T)) {
      throw new TypeError(`${label} does not support HTTP capability '${capability}'`)
    }
  }
  return values as readonly T[]
}

function stringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  const result = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0) {
      throw new TypeError(`${label} must contain non-empty strings`)
    }
    if (result.has(item)) throw new TypeError(`${label} contains duplicate value '${item}'`)
    result.add(item)
  }
  return [...result]
}

function isStepRead(value: StepCapability): value is (typeof STEP_READS)[number] {
  return STEP_READS.includes(value as (typeof STEP_READS)[number])
}

function isFlowCommand(value: FlowAccess): value is FlowCommandType {
  return FLOW_COMMAND_TYPES.includes(value as FlowCommandType)
}

function isStepCommand(value: StepCapability): value is StepCommandType {
  return STEP_COMMAND_TYPES.includes(value as StepCommandType)
}
