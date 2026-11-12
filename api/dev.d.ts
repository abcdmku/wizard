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
 * })
 * ```
 * @public
 */
declare function devWizard<F extends AnyWizard>(wizard: F, options?: {
  readonly deps?: Partial<DepsOf<F>>;
  readonly input?: ContextInput<F>;
  readonly events?: { readonly [E in EventType<F>]?: EventSource; };
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
} | {
  readonly kind: 'failed';
  readonly step: string;
  readonly error?: unknown;
};
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
  /** How many things the run waits for. */
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
  readonly pending: readonly Pending[];
  readonly events: readonly RunEvent<AnyWizardDefinition>[];
  readonly result?: RunResult<AnyWizardDefinition>;
  /** The time the run reads, which moves ahead of the wall clock when a timer is skipped. */
  readonly now: number;
  /** When the next timer fires, by the run's clock. */
  readonly nextTimer?: number;
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
export { type Action, type ActionResult, type Catalog, type DevConfig, type DevServer, type DevServerOptions, type DevWizard, type EventSource, type Pending, type RunDetail, type RunSummary, type Services, type StartRequest, type WizardInfo, defineDev, devWizard, startDevServer };
//# sourceMappingURL=index.d.ts.map