import type { AnyWizard, ExposeSpec, ProjectionDefinition } from '@openwizard/core'
import { type FlowGraph, type FlowGraphNode, inspect, toJSONSchema } from '@openwizard/core/inspect'
import { isRecord, partialSchema, pickProperties, refTo, type SchemaRegistry } from './json-schema'
import { pascalCase } from './naming'
import type { JSONSchema } from './openapi-types'

/** Component names of one API, prefixed with its id so several flows share a document. */
export interface FlowSchemaNames {
  readonly prefix: string
  readonly input: string
  readonly run: string
  readonly stepState: string
  readonly command: string
  readonly frame: string
  payload(event: string): string
  draft(step: string): string
  state(step: string): string
}

export function flowSchemaNames(id: string): FlowSchemaNames {
  const prefix = pascalCase(id, 'Run')
  return {
    prefix,
    input: `${prefix}Input`,
    run: `${prefix}Run`,
    stepState: `${prefix}StepState`,
    command: `${prefix}Command`,
    frame: `${prefix}RunFrame`,
    payload: (event) => `${prefix}${pascalCase(event, 'Event')}Payload`,
    draft: (step) => `${prefix}${pascalCase(step, 'Step')}Draft`,
    state: (step) => `${prefix}${pascalCase(step, 'Step')}State`,
  }
}

/**
 * Everything the OpenAPI builders read about one flow: the core manifest (`inspect`) for step
 * kinds, prose and JSON Schemas, the component names, and the registry they fill.
 */
export interface FlowDocs<F extends AnyWizard> {
  readonly flow: F
  readonly description: string | undefined
  readonly steps: ReadonlyMap<string, FlowGraphNode>
  readonly schemas: FlowGraph['schemas']
  readonly names: FlowSchemaNames
  readonly registry: SchemaRegistry
}

export function flowDocs<F extends AnyWizard>(
  flow: F,
  names: FlowSchemaNames,
  registry: SchemaRegistry,
): FlowDocs<F> {
  const graph = inspect(flow)
  return {
    flow,
    description: graph.description,
    steps: new Map(
      graph.nodes.filter((node) => node.path.length === 0).map((node) => [node.id, node]),
    ),
    schemas: graph.schemas,
    names,
    registry,
  }
}

/** The context input accepted by `createRun`, from the flow's context boundary. */
export function registerInput(docs: FlowDocs<AnyWizard>): void {
  docs.registry.ref(
    docs.names.input,
    withDescription(
      docs.schemas.context ?? {},
      docs.description ?? `The context that creates a run of ${docs.flow.name}.`,
    ),
  )
}

export function registerPayload(docs: FlowDocs<AnyWizard>, event: string): JSONSchema {
  const schema = docs.schemas.events[event] ?? {}
  return docs.registry.ref(
    docs.names.payload(event),
    withDescription(schema, `Payload of the ${event} event.`),
  )
}

/** Partial view input (a draft patch), for `setInput` and exposed view inputs. */
export function registerDraft(docs: FlowDocs<AnyWizard>, step: string): JSONSchema {
  const schema = partialSchema(docs.steps.get(step)?.input ?? {})
  return docs.registry.ref(
    docs.names.draft(step),
    withDescription(schema, `Draft input of the ${step} view.`),
  )
}

/**
 * The projected run state (`ClientState`) for an `expose` projection; a `select` projection's
 * shape is its mapper's and is documented as an open object.
 */
export function registerRun<F extends AnyWizard>(
  docs: FlowDocs<F>,
  expose: ExposeSpec<F> | ExposeSpec<ProjectionDefinition<F>> | undefined,
): void {
  const { flow, names, registry } = docs
  if (expose === undefined) {
    registry.ref(names.run, {
      type: 'object',
      description: `State projected from a run of ${flow.name}.`,
    })
    return
  }
  const steps = [...docs.steps.keys()]
  const views = steps.filter((step) => docs.steps.get(step)?.kind === 'view')
  const exposed = new Map<string, unknown>(Object.entries(expose.steps ?? {}))
  const context = pickProperties(toJSONSchema(flow.context, 'output'), expose.context ?? [])
  registry.ref(names.run, {
    type: 'object',
    description: docs.description ?? `Client state of a run of ${flow.name}.`,
    required: [
      'instanceId',
      'epoch',
      'seq',
      'status',
      'current',
      'context',
      'steps',
      ...(expose.progress === true ? ['progress'] : []),
    ],
    properties: {
      instanceId: { type: 'string', description: 'Run id.' },
      epoch: { type: 'integer', description: 'Increments on every resume.' },
      seq: { type: 'integer', description: 'Increments on every applied event.' },
      status: refTo('RunStatus'),
      current: {
        type: ['string', 'null'],
        enum: [...views, null],
        description: 'The view the user is on, or null.',
      },
      context: registry.ref(`${names.run}Context`, context),
      steps: registry.ref(`${names.run}Steps`, {
        type: 'object',
        required: steps,
        properties: Object.fromEntries(
          steps.map((step) => [step, registerState(docs, step, exposed.get(step))]),
        ),
      }),
      ...(expose.output === true
        ? { output: { description: 'Flow output once the run is done.' } }
        : {}),
      ...(expose.progress === true ? { progress: refTo('Progress') } : {}),
    },
  })
}

/** Discriminated union (on `id`) of the readable steps' states: the step-read response. */
export function registerStepState<F extends AnyWizard>(
  docs: FlowDocs<F>,
  expose: ExposeSpec<F> | ExposeSpec<ProjectionDefinition<F>> | undefined,
  steps: readonly string[],
): void {
  const exposed = new Map<string, unknown>(Object.entries(expose?.steps ?? {}))
  const mapping = Object.fromEntries(
    steps.map((step) => [step, `#/components/schemas/${docs.names.state(step)}`]),
  )
  for (const step of steps) registerState(docs, step, exposed.get(step))
  docs.registry.ref(docs.names.stepState, {
    description: 'State of one step, discriminated by its id.',
    oneOf: Object.values(mapping).map(($ref) => ({ $ref })),
    discriminator: { propertyName: 'id', mapping },
  })
}

function registerState(docs: FlowDocs<AnyWizard>, step: string, exposed: unknown): JSONSchema {
  const on = (key: string) =>
    isRecord(exposed) && exposed[key] !== undefined && exposed[key] !== false
  const node = docs.steps.get(step)
  const properties: Record<string, JSONSchema> = {
    id: { type: 'string', enum: [step] },
    kind: { type: 'string', enum: [node?.kind ?? 'step'] },
    status: refTo('StepStatus'),
    phase: refTo('StepPhase'),
    attempt: { type: 'integer', minimum: 0 },
  }
  if (on('input')) properties.input = registerDraft(docs, step)
  if (on('output')) properties.output = node?.output ?? {}
  if (on('issues')) properties.issues = { type: 'array', items: refTo('Issue') }
  if (on('error')) properties.error = refTo('StepError')
  if (on('child')) {
    properties.child =
      isRecord(exposed) && isRecord(exposed.child)
        ? { type: 'object', description: 'Projected state of the nested run.' }
        : refTo('ChildSummary')
  }
  return docs.registry.ref(docs.names.state(step), {
    type: 'object',
    description: node?.description ?? `State of the ${step} step.`,
    required: ['id', 'kind', 'status', 'attempt'],
    properties,
  })
}

function withDescription(schema: JSONSchema, description: string): JSONSchema {
  return schema.description !== undefined ? schema : { ...schema, description }
}
