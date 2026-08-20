import { type AnyFlow, defineProjection, type EventType, type Projection } from '@openwizard/core'
import { commandAllowed, planAccess } from './access'
import { defineRunAPI } from './api'
import { createCommandSchema } from './command-openapi'
import { defineHTTPResources } from './http'
import type {
  CreateHTTPOptions,
  HTTPAPIOptions,
  ReceiverEventOptions,
  ReceiverEvents,
  ReceiverOptions,
  WizardHTTP,
} from './http-options'
import type { AnyWebhookResource, WebhookResourceOptions } from './types'
import { defineWebhook, defineWebhooks } from './webhook'

/** Generate the opted-in HTTP routes and documentation for a flow. @public */
export function createHTTP<F extends AnyFlow, S = unknown, P = unknown>(
  flow: F,
  options: CreateHTTPOptions<F, S, P>,
): WizardHTTP<F> {
  const id = options.id ?? flow.name
  if (id.length === 0) throw new TypeError('HTTP id must not be empty')
  if (
    options.api === undefined &&
    options.receive === undefined &&
    options.outbound === undefined
  ) {
    throw new TypeError('createHTTP requires api, receive, outbound, or a combination')
  }
  const receivers = options.receive === undefined ? [] : createReceivers(flow, id, options.receive)
  const api = options.api === undefined ? undefined : createAPI(flow, id, options.api)
  const resources = defineHTTPResources([
    ...receivers,
    ...(api === undefined ? [] : api.resources),
    ...(options.outbound?.resources ?? []),
  ])
  if (resources.length === 0) throw new TypeError('HTTP configuration generated no routes')
  return Object.freeze({
    id,
    flow,
    resources,
    receivers,
    ...(options.outbound === undefined ? {} : { outbound: options.outbound }),
  })
}

function createAPI<F extends AnyFlow, S, P>(flow: F, id: string, options: HTTPAPIOptions<F, S, P>) {
  if (typeof options.data?.get !== 'function') {
    throw new TypeError('API data layer must provide get(tenantId, runId)')
  }
  const access = planAccess(flow, options.access ?? true)
  if (!access.readRun && access.readSteps.length === 0 && !access.hasCommands) {
    throw new TypeError('API access generated no run, step, or command routes')
  }
  const projection: Projection<F, unknown> =
    options.projection ?? defineProjection(flow, { expose: access.expose })
  const docs = {
    ...options.docs,
    ...(access.hasCommands && options.docs?.commandSchema === undefined
      ? {
          commandSchema: createCommandSchema(flow, {
            flow: access.flowCommands,
            steps: access.stepCommands,
            events: access.events,
          }),
        }
      : {}),
  }
  const readScopes =
    options.scopes === undefined
      ? undefined
      : {
          ...(options.scopes.run === undefined ? {} : { run: options.scopes.run }),
          ...(options.scopes.step === undefined ? {} : { step: options.scopes.step }),
        }
  return defineRunAPI<F, unknown, P>({
    flow,
    id,
    projection,
    scopeProvider: options.auth,
    resolveRun: ({ tenantId, runId }) => options.data.get(tenantId, runId),
    readRun: access.readRun,
    readSteps: access.readSteps,
    ...(options.path === undefined ? {} : { basePath: options.path }),
    ...(readScopes === undefined ? {} : { readScopes }),
    ...(access.hasCommands
      ? {
          commands: {
            allow: ({ command }) => commandAllowed<F>(access, command),
            ...(options.scopes?.command === undefined ? {} : { scopes: options.scopes.command }),
            ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
          },
        }
      : {}),
    ...(Object.keys(docs).length === 0 ? {} : { documentation: docs }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  })
}

function createReceivers<F extends AnyFlow>(
  flow: F,
  id: string,
  options: ReceiverOptions<F>,
): readonly AnyWebhookResource[] {
  const events = receiverEvents(flow, options.events ?? true)
  const prefix = normalizePrefix(options.path ?? '/webhooks')
  return defineWebhooks(
    events.map(({ event, override }) => {
      const resource: WebhookResourceOptions<F, typeof event> = {
        flow,
        event,
        id: `${id}:receive:${event}`,
        path: override?.path ?? `${prefix}/${event}`,
        secret: override?.secret ?? options.secret,
        resolveRun: options.resolve,
        ...(override?.correlationId === undefined ? {} : { correlationId: override.correlationId }),
        ...(override?.docs === undefined ? {} : { documentation: override.docs }),
        ...(options.idempotency === undefined ? {} : { idempotency: options.idempotency }),
        ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
      }
      return defineWebhook(resource)
    }),
  )
}

function receiverEvents<F extends AnyFlow>(
  flow: F,
  selection: ReceiverEvents<F>,
): Array<{
  readonly event: EventType<F>
  readonly override: ReceiverEventOptions<EventType<F>> | undefined
}> {
  const available = Object.keys(flow.events ?? {}) as EventType<F>[]
  if (selection === true) return available.map((event) => ({ event, override: undefined }))
  if (Array.isArray(selection)) {
    validateEvents(available, selection)
    return selection.map((event) => ({ event, override: undefined }))
  }
  const result: Array<{
    readonly event: EventType<F>
    readonly override: ReceiverEventOptions<EventType<F>>
  }> = []
  for (const [event, override] of Object.entries(selection)) {
    if (!available.includes(event as EventType<F>)) {
      throw new TypeError(`receiver configuration contains unknown event '${event}'`)
    }
    if (override !== undefined) {
      result.push({
        event: event as EventType<F>,
        override: override as ReceiverEventOptions<EventType<F>>,
      })
    }
  }
  return result
}

function validateEvents<F extends AnyFlow>(
  available: readonly EventType<F>[],
  selected: readonly EventType<F>[],
): void {
  const seen = new Set<string>()
  for (const event of selected) {
    if (!available.includes(event))
      throw new TypeError(`receiver contains unknown event '${event}'`)
    if (seen.has(event)) throw new TypeError(`receiver contains duplicate event '${event}'`)
    seen.add(event)
  }
}

function normalizePrefix(prefix: string): string {
  if (
    !prefix.startsWith('/') ||
    prefix.includes('?') ||
    prefix.includes('#') ||
    prefix.includes(':')
  ) {
    throw new TypeError(
      'receiver path must be an absolute pathname without parameters, query, or hash',
    )
  }
  if (prefix === '/') return ''
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
}
