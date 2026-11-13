import { Manifest } from "@openwizard/core/inspect";
import { AnyWizard, AnyWizardDefinition, ContextInput, DepsOf, EventType, RunEvent, RunResult } from "@openwizard/core";
//#region src/config.d.ts
/**
 * Where an event comes from in production, so the UI can say what the run is waiting for: a
 * `webhook` another system posts, a message from a `queue`, or a call from your own `code`.
 * `from` names the sender, such as `Stripe` or `orders topic`.
 * @public
 */
interface EventSource {
  readonly source: 'webhook' | 'queue' | 'code';
  readonly from?: string;
}
/**
 * Values the UI opens its editors with, so a person can press the button without typing:
 * `forms` by the id of a view, `events` by event name, and `calls` by the service call a step
 * makes, such as `orders.find`. A call has no schema, so its example is the only hint of what
 * the service returns.
 * @public
 */
interface DevExamples {
  readonly forms?: Readonly<Record<string, unknown>>;
  readonly events?: Readonly<Record<string, unknown>>;
  readonly calls?: Readonly<Record<string, unknown>>;
}
/**
 * One wizard in a dev config, made by `devWizard`.
 * @public
 */
interface DevWizard {
  readonly wizard: AnyWizard;
  /** Real services. Without them, each service call waits for an answer in the UI. */
  readonly deps?: object;
  /** The input the Start form opens with. */
  readonly input?: unknown;
  /** Where each event comes from in production, by event name. */
  readonly events?: Readonly<Record<string, EventSource>>;
  /** What the form, event and service call editors start with. */
  readonly examples?: DevExamples;
}
/**
 * What `defineDev` takes: the wizards the dev server shows.
 * @public
 */
interface DevConfig {
  readonly wizards: readonly DevWizard[];
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
declare function devWizard<F extends AnyWizard>(wizard: F, options?: {
  readonly deps?: Partial<DepsOf<F>>;
  readonly input?: ContextInput<F>;
  readonly events?: { readonly [E in EventType<F>]?: EventSource; };
  readonly examples?: {
    readonly forms?: Readonly<Record<string, unknown>>;
    readonly events?: { readonly [E in EventType<F>]?: unknown; };
    readonly calls?: Readonly<Record<string, unknown>>;
  };
}): DevWizard;
/**
 * Declares what `openwizard dev` shows. Export the result as the default export of the entry
 * file.
 *
 * ```ts
 * export default defineDev({ wizards: [devWizard(refund), devWizard(signup)] })
 * ```
 * @public
 */
declare function defineDev(config: DevConfig): DevConfig;
//#endregion
//#region src/server/server.d.ts
/**
 * What `startDevServer` takes: the `entry` file that exports the wizards or a `defineDev`
 * config, the `port` (default 4400, `0` for any free port), the `host` (default `127.0.0.1`)
 * and `watch` (default true) to reload when a source file changes.
 * @public
 */
interface DevServerOptions {
  readonly entry: string;
  readonly port?: number;
  readonly host?: string;
  readonly watch?: boolean;
}
/**
 * A running dev server: its `url`, `reload()` to load the entry file again and `close()`.
 * @public
 */
interface DevServer {
  readonly url: string;
  readonly port: number;
  reload(): Promise<void>;
  close(): Promise<void>;
}
/**
 * Starts the dev server: loads the entry file, serves the browser UI and the API it uses, and
 * reloads the wizards when a source file changes. Runs live in memory and end with the server.
 *
 * It accepts requests for a local host name only, and a write must be JSON from the same
 * origin, so a web page on another site cannot drive a run.
 * @public
 */
declare function startDevServer(options: DevServerOptions): Promise<DevServer>;
//#endregion
//#region src/wire.d.ts
/** A JSON Schema as `inspect` reports it. */
type Schema = NonNullable<Manifest['schemas']['context']>;
/**
 * One wizard the dev server loaded: what `inspect` knows about it, the page `toMarkdown`
 * prints, an input to start a run with and whether real services are configured.
 * @public
 */
interface WizardInfo {
  readonly name: string;
  readonly description?: string;
  readonly version: number;
  readonly manifest: Manifest;
  readonly markdown: string;
  /** The `input` of its dev entry, or a value filled in from the context schema. */
  readonly exampleInput: unknown;
  /** True when the dev config supplies `deps` for it. */
  readonly hasDeps: boolean;
  /** The services the dev config supplies, by their name on `deps`. */
  readonly services: readonly string[];
  /** Where each event comes from in production, when the dev config says. */
  readonly events: Readonly<Record<string, EventSource>>;
  /** What the editors start with, when the dev config says. */
  readonly examples: DevExamples;
}
/**
 * Everything the dev server loaded from the entry file, and the error when loading failed.
 * @public
 */
interface Catalog {
  readonly entry: string;
  readonly loadedAt: number;
  readonly wizards: readonly WizardInfo[];
  readonly error?: string;
}
/**
 * Who answers a service call: the `deps` from the dev config, or the person at the UI.
 * @public
 */
type Services = 'real' | 'manual';
/**
 * Something a run waits for that the UI can supply.
 * @public
 */
type Pending = {
  readonly kind: 'view';
  readonly path: readonly string[];
  readonly step: string;
  readonly schema?: Schema;
  readonly draft?: unknown;
} | {
  readonly kind: 'event';
  readonly path: readonly string[];
  readonly step: string;
  readonly events: readonly {
    readonly name: string;
    readonly schema?: Schema;
    readonly origin?: EventSource;
    /** The payload the editor starts with. */
    readonly example?: unknown;
  }[];
  readonly deadline?: number;
} | {
  readonly kind: 'sleep';
  readonly path: readonly string[];
  readonly step: string;
  readonly deadline: number;
} | {
  readonly kind: 'call';
  readonly id: string;
  readonly name: string;
  readonly args: readonly unknown[];
  /** The return value the editor starts with. */
  readonly example?: unknown;
  /**
   * The step that made the call and the path of its run, when exactly one step is running.
   * Several steps running at once leave these out, since a call does not name its caller.
   */
  readonly step?: string;
  readonly path?: readonly string[];
  /** Which attempt of that step this is, from 1, and how many its retry policy allows. */
  readonly attempt?: number;
  readonly attempts?: number;
  /** True when the step's undo hook made the call, while the run undoes finished work. */
  readonly undo?: true;
} | {
  readonly kind: 'failed';
  readonly step: string;
  readonly error?: unknown;
};
/**
 * The run's next timer and what it is for. `retry` is the delay before a failed step tries
 * again, `timeout` the run timeout of a step that is working, `waitTimeout` the timeout of an
 * event wait, `undoTimeout` the timeout of an undo hook that is working and `sleep` the end of a
 * sleep. `unknown` when the dev server cannot tell.
 * @public
 */
interface NextTimer {
  readonly at: number;
  readonly purpose: 'retry' | 'timeout' | 'undoTimeout' | 'waitTimeout' | 'sleep' | 'inboxTtl' | 'compensationGrace' | 'unknown';
  /** The step the timer belongs to, and the path of its run (`[]` for the root). */
  readonly step?: string;
  readonly path: readonly string[];
  /** For `retry`, the attempt the timer starts. For `timeout`, the attempt that is running. */
  readonly attempt?: number;
  /** How many attempts the step's retry policy allows in all. */
  readonly attempts?: number;
}
/**
 * One row of the run list.
 * @public
 */
interface RunSummary {
  readonly id: string;
  readonly wizard: string;
  readonly status: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly services: Services;
  /** The wizard was reloaded with a different definition after this run started. */
  readonly stale: boolean;
  /**
   * How many things the run waits for that a person supplies: forms, events, service calls
   * answered by hand and failed steps. A sleep or another timer fires on its own and is not
   * counted.
   */
  readonly waiting: number;
}
/**
 * Everything the UI shows for one run.
 * @public
 */
interface RunDetail extends RunSummary {
  readonly input: unknown;
  /** `run.getSnapshot()`: the state and the live children. */
  readonly snapshot: unknown;
  /** `run.explain(step).phase` for each step of the root wizard. */
  readonly phases: Readonly<Record<string, string>>;
  /**
   * `run.explain(step).reasons` for each step of the root wizard that has any, such as
   * `deps-unmet:order`.
   */
  readonly reasons: Readonly<Record<string, readonly string[]>>;
  readonly pending: readonly Pending[];
  readonly events: readonly RunEvent<AnyWizardDefinition>[];
  readonly result?: RunResult<AnyWizardDefinition>;
  /** The time the run reads, which moves ahead of the wall clock when a timer is skipped. */
  readonly now: number;
  /** When the next timer fires, by the run's clock. */
  readonly nextTimer?: number;
  /** What the next timer is for, when the run has one. */
  readonly timer?: NextTimer;
}
/**
 * What the UI can ask a run to do.
 * @public
 */
type Action = {
  readonly type: 'submit';
  readonly path: readonly string[];
  readonly step: string;
  readonly input: unknown;
} | {
  readonly type: 'send';
  readonly event: string;
  readonly payload: unknown;
} | {
  readonly type: 'resolve';
  readonly id: string;
  readonly value: unknown;
} | {
  readonly type: 'reject';
  readonly id: string;
  readonly message: string;
} | {
  readonly type: 'skipTimer';
} | {
  readonly type: 'retry';
  readonly step: string;
} | {
  readonly type: 'skip';
  readonly step: string;
} | {
  readonly type: 'cancel';
} |
/** Disposes the run and resumes it from its snapshot, as a restarted process would. */
{
  readonly type: 'restart';
};
/**
 * The answer to an action. `issues` lists what a schema refused.
 * @public
 */
interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly issues?: readonly {
    readonly message: string;
    readonly path?: readonly unknown[];
  }[];
}
/**
 * What `POST /api/runs` accepts.
 * @public
 */
interface StartRequest {
  readonly wizard: string;
  readonly input: unknown;
  readonly services?: Services;
}
//#endregion
export { type Action, type ActionResult, type Catalog, type DevConfig, type DevServer, type DevServerOptions, type DevWizard, type EventSource, type NextTimer, type Pending, type RunDetail, type RunSummary, type Services, type StartRequest, type WizardInfo, defineDev, devWizard, startDevServer };
//# sourceMappingURL=index.d.ts.map