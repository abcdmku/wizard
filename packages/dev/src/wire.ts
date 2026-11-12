/**
 * The JSON the dev server sends and accepts. The browser UI imports these types only, so the
 * server and the UI cannot disagree about a field.
 *
 * @packageDocumentation
 */

import type { AnyWizardDefinition, RunEvent, RunResult } from '@openwizard/core'
import type { Manifest } from '@openwizard/core/inspect'
import type { EventSource } from './config'

/** A JSON Schema as `inspect` reports it. */
export type Schema = NonNullable<Manifest['schemas']['context']>

/**
 * One wizard the dev server loaded: what `inspect` knows about it, the page `toMarkdown`
 * prints, an input to start a run with and whether real services are configured.
 * @public
 */
export interface WizardInfo {
  readonly name: string
  readonly description?: string
  readonly version: number
  readonly manifest: Manifest
  readonly markdown: string
  /** The `input` of its dev entry, or a value filled in from the context schema. */
  readonly exampleInput: unknown
  /** True when the dev config supplies `deps` for it. */
  readonly hasDeps: boolean
  /** The services the dev config supplies, by their name on `deps`. */
  readonly services: readonly string[]
  /** Where each event comes from in production, when the dev config says. */
  readonly events: Readonly<Record<string, EventSource>>
}

/**
 * Everything the dev server loaded from the entry file, and the error when loading failed.
 * @public
 */
export interface Catalog {
  readonly entry: string
  readonly loadedAt: number
  readonly wizards: readonly WizardInfo[]
  readonly error?: string
}

/**
 * Who answers a service call: the `deps` from the dev config, or the person at the UI.
 * @public
 */
export type Services = 'real' | 'manual'

/**
 * Something a run waits for that the UI can supply.
 * @public
 */
export type Pending =
  | {
      readonly kind: 'view'
      readonly path: readonly string[]
      readonly step: string
      readonly schema?: Schema
      readonly draft?: unknown
    }
  | {
      readonly kind: 'event'
      readonly path: readonly string[]
      readonly step: string
      readonly events: readonly {
        readonly name: string
        readonly schema?: Schema
        readonly origin?: EventSource
      }[]
      readonly deadline?: number
    }
  | {
      readonly kind: 'sleep'
      readonly path: readonly string[]
      readonly step: string
      readonly deadline: number
    }
  | {
      readonly kind: 'call'
      readonly id: string
      readonly name: string
      readonly args: readonly unknown[]
    }
  | {
      readonly kind: 'failed'
      readonly step: string
      readonly error?: unknown
    }

/**
 * One row of the run list.
 * @public
 */
export interface RunSummary {
  readonly id: string
  readonly wizard: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly services: Services
  /** The wizard was reloaded with a different definition after this run started. */
  readonly stale: boolean
  /** How many things the run waits for. */
  readonly waiting: number
}

/**
 * Everything the UI shows for one run.
 * @public
 */
export interface RunDetail extends RunSummary {
  readonly input: unknown
  /** `run.getSnapshot()`: the state and the live children. */
  readonly snapshot: unknown
  /** `run.explain(step).phase` for each step of the root wizard. */
  readonly phases: Readonly<Record<string, string>>
  readonly pending: readonly Pending[]
  readonly events: readonly RunEvent<AnyWizardDefinition>[]
  readonly result?: RunResult<AnyWizardDefinition>
  /** The time the run reads, which moves ahead of the wall clock when a timer is skipped. */
  readonly now: number
  /** When the next timer fires, by the run's clock. */
  readonly nextTimer?: number
}

/**
 * What the UI can ask a run to do.
 * @public
 */
export type Action =
  | {
      readonly type: 'submit'
      readonly path: readonly string[]
      readonly step: string
      readonly input: unknown
    }
  | { readonly type: 'send'; readonly event: string; readonly payload: unknown }
  | { readonly type: 'resolve'; readonly id: string; readonly value: unknown }
  | { readonly type: 'reject'; readonly id: string; readonly message: string }
  | { readonly type: 'skipTimer' }
  | { readonly type: 'retry'; readonly step: string }
  | { readonly type: 'skip'; readonly step: string }
  | { readonly type: 'cancel' }

/**
 * The answer to an action. `issues` lists what a schema refused.
 * @public
 */
export interface ActionResult {
  readonly ok: boolean
  readonly message?: string
  readonly issues?: readonly { readonly message: string; readonly path?: readonly unknown[] }[]
}

/**
 * What `POST /api/runs` accepts.
 * @public
 */
export interface StartRequest {
  readonly wizard: string
  readonly input: unknown
  readonly services?: Services
}
