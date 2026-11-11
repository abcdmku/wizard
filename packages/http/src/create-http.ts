import type { AnyWizard } from '@openwizard/core'
import type { SharedOptions } from './api-context'
import { createRunAPI } from './api-routes'
import { combineHTTP } from './combine'
import type { CreateHTTPOptions, HTTPRunAPIOptions, WizardHTTP } from './http-options'
import { createMemoryIdempotencyStore } from './idempotency'
import { createSchemaRegistry } from './json-schema'
import type { OpenAPITag } from './openapi-types'
import { wizardDocs, wizardSchemaNames } from './openapi-wizard'
import { createReceivers } from './receive'

/**
 * Generate the HTTP routes and the OpenAPI 3.1 document of a wizard: the run API (`runs`,
 * `auth` and deny-by-default `access` together) and/or signed receivers (`receive`). The result
 * is framework-neutral: serve `http.fetch` from any `Request → Response` runtime and
 * `http.openAPI(info)` as the document.
 * @public
 */
export function createHTTP<F extends AnyWizard, S = unknown, P = unknown>(
  wizard: F,
  options: CreateHTTPOptions<F, S, P>,
): WizardHTTP<F> {
  const id = options.id ?? wizard.name
  if (typeof id !== 'string' || id.length === 0)
    throw new TypeError('createHTTP id must not be empty')
  const docs = wizardDocs(wizard, wizardSchemaNames(id), createSchemaRegistry())
  const shared: SharedOptions = {
    idempotency: options.idempotency ?? createMemoryIdempotencyStore(),
    onError: options.onError,
  }
  const api = hasRunAPI(options) ? createRunAPI(docs, id, options, shared) : undefined
  const receivers =
    options.receive === undefined ? [] : createReceivers(docs, id, options.receive, shared)
  if (api === undefined && options.receive === undefined) {
    throw new TypeError('createHTTP needs the run API (runs, auth, access), receive, or both')
  }
  const tags: OpenAPITag[] = [
    ...(api === undefined
      ? []
      : [{ name: id, description: docs.description ?? `Runs of the ${wizard.name} wizard.` }]),
    ...(receivers.length === 0
      ? []
      : [
          {
            name: `${id}.webhooks`,
            description: `Signed webhooks that deliver ${wizard.name} events.`,
          },
        ]),
  ]
  const handler = combineHTTP(
    [
      {
        resources: [...(api?.resources ?? []), ...receivers],
        openAPIComponents: {
          schemas: docs.registry.schemas,
          securitySchemes: api?.securitySchemes ?? {},
          webhooks: {},
          tags,
        },
      },
    ],
    options.cors === undefined ? {} : { cors: options.cors },
  )
  return Object.freeze({ id, wizard, ...handler })
}

/** Whether `options` turn the run API on; `runs`, `auth` and `access` come together. */
function hasRunAPI<F extends AnyWizard, S, P>(
  options: CreateHTTPOptions<F, S, P>,
): options is CreateHTTPOptions<F, S, P> & HTTPRunAPIOptions<F, S, P> {
  const present = [options.runs, options.auth, options.access].filter(
    (value) => value !== undefined,
  )
  if (present.length === 0) return false
  if (present.length < 3) throw new TypeError('the run API needs runs, auth and access together')
  return true
}
