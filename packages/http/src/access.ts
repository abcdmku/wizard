import type { AnyWizard, Command, ExposeSpec } from '@openwizard/core'
import type { ManifestStep } from '@openwizard/core/inspect'
import type { HTTPAccess, RunAccess } from './http-options'

export const RUN_COMMAND_TYPES = [
  'start',
  'next',
  'back',
  'startReady',
  'cancel',
  'compensate',
  'reset',
] as const
export const STEP_COMMAND_TYPES = [
  'go',
  'invalidate',
  'resetInput',
  'retry',
  'startStep',
  'setInput',
  'skip',
  'child',
] as const
export type RunCommandType = (typeof RUN_COMMAND_TYPES)[number]
export type StepCommandType = (typeof STEP_COMMAND_TYPES)[number]

const STEP_READS = ['read', 'input', 'output', 'issues', 'error', 'summary'] as const
type StepRead = (typeof STEP_READS)[number]
type StepCapability = StepRead | StepCommandType
const RUN_CAPABILITIES = [
  'create',
  'read',
  'output',
  'progress',
  ...RUN_COMMAND_TYPES,
] as const satisfies readonly RunAccess[]

/** The routes and projection one `access` declaration unlocks. Nothing is on by default. */
export interface AccessPlan<F extends AnyWizard> {
  readonly create: boolean
  readonly readRun: boolean
  readonly readSteps: readonly string[]
  readonly expose: ExposeSpec<F>
  readonly runCommands: ReadonlySet<RunCommandType>
  readonly stepCommands: ReadonlyMap<string, ReadonlySet<StepCommandType>>
  readonly events: readonly string[]
}

/**
 * Check `access` against the wizard's steps (from its manifest) and events and resolve what it
 * unlocks. Throws a `TypeError` for anything the wizard does not have or the step cannot do.
 */
export function planAccess<F extends AnyWizard>(
  steps: ReadonlyMap<string, ManifestStep>,
  events: readonly string[],
  access: HTTPAccess<F>,
): AccessPlan<F> {
  if (typeof access !== 'object' || access === null || Array.isArray(access)) {
    throw new TypeError('access must list the exposed capabilities (nothing is exposed by default)')
  }
  const runCapabilities = capabilityList(access.run ?? [], RUN_CAPABILITIES, 'run access')
  const context = stringList(access.context ?? [], 'context access')
  const readSteps: string[] = []
  const stepCommands = new Map<string, ReadonlySet<StepCommandType>>()
  const exposedSteps: Record<string, object> = {}
  for (const [step, raw] of Object.entries(access.steps ?? {})) {
    const node = steps.get(step)
    if (node === undefined) throw new TypeError(`access contains unknown step '${step}'`)
    if (raw === undefined) continue
    const capabilities = capabilityList(raw, stepCapabilities(node), `access for step '${step}'`)
    const reads = capabilities.filter(isStepRead)
    if (reads.length > 0) {
      readSteps.push(step)
      exposedSteps[step] = stepExpose(node.kind, reads)
    }
    const commands = capabilities.filter(isStepCommand)
    if (commands.length > 0) stepCommands.set(step, new Set(commands))
  }
  const reads = (...values: RunAccess[]) => runCapabilities.some((value) => values.includes(value))
  const expose = {
    context,
    ...(reads('read', 'output') ? { output: true } : {}),
    ...(reads('read', 'progress') ? { progress: true } : {}),
    steps: exposedSteps,
  }
  return {
    create: runCapabilities.includes('create'),
    readRun: context.length > 0 || reads('read', 'output', 'progress'),
    readSteps,
    // `ExposeSpec<F>` keys are literals of one wizard; every list above was checked against the wizard.
    expose: expose as ExposeSpec<F>,
    runCommands: new Set(runCapabilities.filter(isRunCommand)),
    stepCommands,
    events: selectedEvents(events, access.events ?? []),
  }
}

export function hasCommands<F extends AnyWizard>(plan: AccessPlan<F>): boolean {
  return plan.runCommands.size > 0 || plan.stepCommands.size > 0
}

/** Whether `command` is inside the declared access (event sends need a listed event). */
export function commandAllowed<F extends AnyWizard>(
  plan: AccessPlan<F>,
  command: Command<F>,
): boolean {
  if (command.type === 'send') return plan.events.includes(command.event)
  if (command.type === 'child') return plan.stepCommands.get(command.path[0])?.has('child') === true
  if ('step' in command) return plan.stepCommands.get(command.step)?.has(command.type) === true
  return plan.runCommands.has(command.type)
}

function stepCapabilities(node: ManifestStep): readonly StepCapability[] {
  return [
    'read',
    'output',
    'issues',
    'error',
    'invalidate',
    'skip',
    ...(node.kind === 'view' ? (['input', 'go', 'resetInput', 'setInput'] as const) : []),
    ...(node.hooks.includes('run') ? (['retry', 'startStep'] as const) : []),
    ...(node.kind === 'child' ? (['summary', 'child'] as const) : []),
  ]
}

function stepExpose(kind: string, reads: readonly StepRead[]): object {
  const all = reads.includes('read')
  const on = (read: StepRead) => all || reads.includes(read)
  return {
    ...(kind === 'view' && on('input') ? { input: true } : {}),
    ...(on('output') ? { output: true } : {}),
    ...(on('issues') ? { issues: true } : {}),
    ...(on('error') ? { error: true } : {}),
    ...(kind === 'child' && on('summary') ? { child: true } : {}),
  }
}

function selectedEvents(
  declared: readonly string[],
  selected: readonly string[],
): readonly string[] {
  const result = stringList(selected, 'event access')
  const unknown = result.find((event) => !declared.includes(event))
  if (unknown !== undefined) throw new TypeError(`access contains unknown event '${unknown}'`)
  return result
}

function capabilityList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): readonly T[] {
  const values = stringList(value, label)
  const unsupported = values.find(
    (capability) => !(allowed as readonly string[]).includes(capability),
  )
  if (unsupported !== undefined) {
    throw new TypeError(`${label} does not support the capability '${unsupported}'`)
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

function isStepRead(value: StepCapability): value is StepRead {
  return (STEP_READS as readonly string[]).includes(value)
}

function isStepCommand(value: StepCapability): value is StepCommandType {
  return (STEP_COMMAND_TYPES as readonly string[]).includes(value)
}

function isRunCommand(value: RunAccess): value is RunCommandType {
  return (RUN_COMMAND_TYPES as readonly string[]).includes(value)
}
