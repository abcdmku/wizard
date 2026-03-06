/**
 * v3 React contracts (type-first).
 *
 * Bound API around an orchestrator runtime that supports wizard, DAG, and saga modes.
 */

export type AnyOrchestrator = {
  state: {
    mode: string;
    status: string;
    current: string | null;
    active: readonly string[];
    context: unknown;
    steps: Record<
      string,
      {
        step: string;
        status: string;
        input?: unknown;
        output?: unknown;
        error?: unknown;
      }
    >;
    history: readonly unknown[];
    saga: {
      stack: readonly string[];
      compensated: readonly string[];
    };
    persistence: {
      enabled: boolean;
      key: string | null;
      autoLoad: boolean;
      autoSave: 'off' | 'on-change' | 'on-event';
      clearOnFinal: boolean;
      status: 'idle' | 'loading' | 'saving' | 'error';
      lastSavedAt: number | null;
      lastLoadedAt: number | null;
      lastError: unknown;
    };
    isTransitioning: boolean;
    version: number;
  };

  __types?: {
    step: string;
    context: unknown;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    error: Record<string, unknown>;
  };

  current(): string | null;
  context(): unknown;

  step(step: string): unknown;
  input(step: string): unknown;
  output(step: string): unknown;
  error(step: string): unknown;

  setInput(step: string, value: unknown): void;
  patchInput(step: string, patch: unknown): void;
  updateContext(fn: (draft: unknown) => void): void;

  canGo(step: string): Promise<boolean>;
  go(step: string, opts?: { reason?: string }): Promise<string>;
  next(): Promise<string | null>;
  back(): Promise<string | null>;

  runReady(opts?: { concurrency?: number }): Promise<readonly string[]>;
  runStep(step: string): Promise<unknown>;
  retry(step: string): Promise<void>;
  compensate(opts?: { from?: string; reason?: string }): Promise<void>;
  loadPersisted(): Promise<boolean>;
  savePersisted(): Promise<void>;
  clearPersisted(): Promise<void>;

  reset(opts?: { hard?: boolean }): void;

  subscribe(listener: (state: unknown) => void): () => void;
  subscribeEvents(listener: (event: unknown) => void): () => void;
};

type TypeBag<O extends AnyOrchestrator> = O extends { __types?: infer T }
  ? NonNullable<T>
  : never;

type InputMapOf<O extends AnyOrchestrator> =
  TypeBag<O> extends { input: infer M }
    ? M extends Record<string, unknown>
      ? M
      : Record<string, unknown>
    : Record<string, unknown>;

type OutputMapOf<O extends AnyOrchestrator> =
  TypeBag<O> extends { output: infer M }
    ? M extends Record<string, unknown>
      ? M
      : Record<string, unknown>
    : Record<string, unknown>;

type ErrorMapOf<O extends AnyOrchestrator> =
  TypeBag<O> extends { error: infer M }
    ? M extends Record<string, unknown>
      ? M
      : Record<string, unknown>
    : Record<string, unknown>;

export type StepIdOf<O extends AnyOrchestrator> = TypeBag<O> extends {
  step: infer S;
}
  ? S & string
  : string;

export type ContextOf<O extends AnyOrchestrator> = TypeBag<O> extends {
  context: infer C;
}
  ? C
  : ReturnType<O['context']>;

export type OrchestratorStateOf<O extends AnyOrchestrator> = O['state'];

export type StepInputOf<O extends AnyOrchestrator, K extends StepIdOf<O>> =
  K extends keyof InputMapOf<O> ? InputMapOf<O>[K] : unknown;

export type StepOutputOf<O extends AnyOrchestrator, K extends StepIdOf<O>> =
  K extends keyof OutputMapOf<O> ? OutputMapOf<O>[K] : unknown;

export type StepErrorOf<O extends AnyOrchestrator, K extends StepIdOf<O>> =
  K extends keyof ErrorMapOf<O> ? ErrorMapOf<O>[K] : unknown;

export type StepSnapshotOf<O extends AnyOrchestrator, K extends StepIdOf<O>> = {
  step: K;
  status: string;
  input: StepInputOf<O, K> | undefined;
  output: StepOutputOf<O, K> | undefined;
  error: StepErrorOf<O, K> | undefined;
  context: ContextOf<O>;
};

export type CurrentSnapshotOf<O extends AnyOrchestrator> = {
  step: StepIdOf<O> | null;
  status: string;
  input: StepInputOf<O, StepIdOf<O>> | undefined;
  output: StepOutputOf<O, StepIdOf<O>> | undefined;
  error: StepErrorOf<O, StepIdOf<O>> | undefined;
  context: ContextOf<O>;
};

export type BoundOrchestratorReact<O extends AnyOrchestrator> = {
  Provider(props: { children: unknown }): unknown;

  useState(): OrchestratorStateOf<O>;

  useCurrent(): CurrentSnapshotOf<O>;

  useStep<K extends StepIdOf<O>>(step: K): StepSnapshotOf<O, K>;

  useError<K extends StepIdOf<O>>(step: K): StepErrorOf<O, K> | undefined;

  useSelector<T>(
    selector: (state: OrchestratorStateOf<O>) => T,
    isEqual?: (a: T, b: T) => boolean
  ): T;

  useActions(): {
    canGo: O['canGo'];
    next: O['next'];
    go: O['go'];
    back: O['back'];
    runReady: O['runReady'];
    runStep: O['runStep'];
    retry: O['retry'];
    compensate: O['compensate'];
    loadPersisted: O['loadPersisted'];
    savePersisted: O['savePersisted'];
    clearPersisted: O['clearPersisted'];
    reset: O['reset'];
    setInput: O['setInput'];
    patchInput: O['patchInput'];
    updateContext: O['updateContext'];
  };
};

export declare function bindOrchestratorReact<O extends AnyOrchestrator>(
  orchestrator: O
): BoundOrchestratorReact<O>;

export declare const bindWizardReact: typeof bindOrchestratorReact;
