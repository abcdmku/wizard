import type { AnyWizard, ContextInput, DepsOf, EventType } from '@openwizard/core'

const DEV_CONFIG = Symbol.for('@openwizard/dev:config')

/**
 * Where an event comes from in production, so the UI can say what the run is waiting for: a
 * `webhook` another system posts, a message from a `queue`, or a call from your own `code`.
 * `from` names the sender, such as `Stripe` or `orders topic`.
 * @public
 */
export interface EventSource {
  readonly source: 'webhook' | 'queue' | 'code'
  readonly from?: string
}

/**
 * Values the UI opens its editors with, so a person can press the button without typing:
 * `forms` by the id of a view, `events` by event name, and `calls` by the service call a step
 * makes, such as `orders.find`. A call has no schema, so its example is the only hint of what
 * the service returns.
 * @public
 */
export interface DevExamples {
  readonly forms?: Readonly<Record<string, unknown>>
  readonly events?: Readonly<Record<string, unknown>>
  readonly calls?: Readonly<Record<string, unknown>>
}

/**
 * One wizard in a dev config, made by `devWizard`.
 * @public
 */
export interface DevWizard {
  readonly wizard: AnyWizard
  /** Real services. Without them, each service call waits for an answer in the UI. */
  readonly deps?: object
  /** The input the Start form opens with. */
  readonly input?: unknown
  /** Where each event comes from in production, by event name. */
  readonly events?: Readonly<Record<string, EventSource>>
  /** What the form, event and service call editors start with. */
  readonly examples?: DevExamples
}

/**
 * What `defineDev` takes: the wizards the dev server shows.
 * @public
 */
export interface DevConfig {
  readonly wizards: readonly DevWizard[]
}

/**
 * Adds a wizard to a dev config, with the services and the starting input it should use and
 * where its events come from.
 *
 * ```ts
 * devWizard(refund, {
 *   input: { orderId: 'o-2' },
 *   events: { 'refund.approved': { source: 'webhook', from: 'Back office' } },
 *   examples: { calls: { 'orders.find': { total: 250 } } },
 * })
 * ```
 * @public
 */
export function devWizard<F extends AnyWizard>(
  wizard: F,
  options: {
    readonly deps?: Partial<DepsOf<F>>
    readonly input?: ContextInput<F>
    readonly events?: { readonly [E in EventType<F>]?: EventSource }
    readonly examples?: {
      readonly forms?: Readonly<Record<string, unknown>>
      readonly events?: { readonly [E in EventType<F>]?: unknown }
      readonly calls?: Readonly<Record<string, unknown>>
    }
  } = {},
): DevWizard {
  return {
    wizard,
    ...(options.deps === undefined ? {} : { deps: options.deps as object }),
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.events === undefined
      ? {}
      : { events: options.events as Readonly<Record<string, EventSource>> }),
    ...(options.examples === undefined ? {} : { examples: options.examples as DevExamples }),
  }
}

/**
 * Declares what `openwizard dev` shows. Export the result as the default export of the entry
 * file.
 *
 * ```ts
 * export default defineDev({ wizards: [devWizard(refund), devWizard(signup)] })
 * ```
 * @public
 */
export function defineDev(config: DevConfig): DevConfig {
  return Object.defineProperty({ ...config }, DEV_CONFIG, { value: true })
}

function isWizard(value: unknown): value is AnyWizard {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { name?: unknown; create?: unknown; resume?: unknown }
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.create === 'function' &&
    typeof candidate.resume === 'function'
  )
}

/**
 * Reads a dev config from the exports of an entry file: the default export when `defineDev`
 * made it, otherwise every exported wizard.
 */
export function configFrom(exports: Readonly<Record<string, unknown>>): DevConfig {
  // A CommonJS entry arrives with its exports under `default`.
  for (const candidate of [exports.default, (exports.default as { default?: unknown })?.default]) {
    if (typeof candidate === 'object' && candidate !== null && DEV_CONFIG in candidate)
      return candidate as unknown as DevConfig
  }
  const found = new Map<string, DevWizard>()
  const scan = (value: unknown) => {
    if (isWizard(value) && !found.has(value.name)) found.set(value.name, { wizard: value })
  }
  for (const value of Object.values(exports)) scan(value)
  if (typeof exports.default === 'object' && exports.default !== null)
    for (const value of Object.values(exports.default)) scan(value)
  return { wizards: [...found.values()] }
}
