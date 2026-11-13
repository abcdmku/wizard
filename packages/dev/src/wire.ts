/**
 * The JSON the dev server sends and accepts. The browser UI imports these types only, so the
 * server and the UI cannot disagree about a field.
 *
 * @packageDocumentation
 */

import type { AnyWizardDefinition, RunEvent, RunResult } from '@openwizard/core'
import type { Manifest } from '@openwizard/core/inspect'
import type { DevExamples, EventSource } from './config'

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
  /** What the editors start with, when the dev config says. */
  readonly examples: DevExamples
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
        /** The payload the editor starts with. */
        readonly example?: unknown
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
      /** The return value the editor starts with. */
      readonly example?: unknown
      /**
       * The step that made the call and the path of its run. The dev server follows the run's
       * events to tell which step a call came from; a call it cannot place leaves these out.
       */
      readonly step?: string
      readonly path?: readonly string[]
      /** Which attempt of that step this is, from 1, and how many its retry policy allows. */
      readonly attempt?: number
      readonly attempts?: number
      /** True when the step's undo hook made the call, while the run undoes finished work. */
      readonly undo?: true
    }
  | {
      readonly kind: 'failed'
      readonly step: string
      readonly error?: unknown
    }

/**
 * The run's next timer and what it is for. `retry` is the delay before a failed step tries
 * again, `timeout` the run timeout of a step that is working, `waitTimeout` the timeout of an
 * event wait, `undoTimeout` the timeout of an undo hook that is working and `sleep` the end of a
 * sleep. `unknown` when the dev server cannot tell.
 * @public
 */
export interface NextTimer {
  readonly at: number
  readonly purpose:
    | 'retry'
    | 'timeout'
    | 'undoTimeout'
    | 'waitTimeout'
    | 'sleep'
    | 'inboxTtl'
    | 'compensationGrace'
    | 'unknown'
  /** The step the timer belongs to, and the path of its run (`[]` for the root). */
  readonly step?: string
  readonly path: readonly string[]
  /** For `retry`, the attempt the timer starts. For `timeout`, the attempt that is running. */
  readonly attempt?: number
  /** How many attempts the step's retry policy allows in all. */
  readonly attempts?: number
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
  /**
   * How many things the run waits for that a person supplies: forms, events, service calls
   * answered by hand and failed steps. A sleep or another timer fires on its own and is not
   * counted. Always 0 once the run is done, failed or cancelled.
   */
  readonly waiting: number
  /** True while a step of the run, or of a child run, waits out a retry delay. */
  readonly retrying: boolean
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
  /**
   * `run.explain(step).reasons` for each step of the root wizard that has any, such as
   * `deps-unmet:order`.
   */
  readonly reasons: Readonly<Record<string, readonly string[]>>
  readonly pending: readonly Pending[]
  /**
   * The run's events, oldest first. A restart from the snapshot adds one event of its own, with
   * the type `dev.restarted`, where it happened.
   */
  readonly events: readonly RunEvent<AnyWizardDefinition>[]
  readonly result?: RunResult<AnyWizardDefinition>
  /** The time the run reads, which moves ahead of the wall clock when a timer is skipped. */
  readonly now: number
  /** When the next timer fires, by the run's clock. */
  readonly nextTimer?: number
  /** What the next timer is for, when the run has one. */
  readonly timer?: NextTimer
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
  /** Disposes the run and resumes it from its snapshot, as a restarted process would. */
  | { readonly type: 'restart' }

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
