/**
 * v3 Orchestrator contracts (type-first).
 *
 * Scope:
 * - wizard navigation
 * - DAG scheduling
 * - saga compensation
 * - durable snapshot + resume
 */

export type StepId<TSteps extends Record<string, unknown>> = keyof TSteps & string;

export type ExecutionMode = 'wizard' | 'dag' | 'saga' | 'hybrid';
export type RuntimeStatus =
  | 'idle'
  | 'running'
  | 'failed'
  | 'compensating'
  | 'completed'
  | 'cancelled';

export type StepKind = 'view' | 'action' | 'gate' | 'final';
export type StepRuntime = 'client' | 'server' | 'either';
export type StepDurability = 'ephemeral' | 'durable';

export type StepStatus =
  | 'idle'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'compensating'
  | 'compensated'
  | 'skipped'
  | 'blocked';

export type RetryPolicy = {
  attempts?: number;
  backoffMs?: number | ((attempt: number) => number);
};

export type CancellationSignal = {
  readonly aborted: boolean;
};

export type PersistenceAutoSave = 'off' | 'on-change' | 'on-event';
export type PersistenceStatus = 'idle' | 'loading' | 'saving' | 'error';

export type FlowEventType =
  | 'enter'
  | 'exit'
  | 'go'
  | 'next'
  | 'back'
  | 'run'
  | 'success'
  | 'fail'
  | 'retry'
  | 'compensate'
  | 'reset'
  | 'resume';

export type FlowEvent<S extends string> = {
  at: number;
  type: FlowEventType;
  step: S | null;
  from: S | null;
  to: S | null;
  reason?: string;
};

export type TransitionTarget<S extends string> = S | readonly S[] | null;

export type TransitionDecision<S extends string> =
  | TransitionTarget<S>
  | {
      target: TransitionTarget<S>;
      reason?: string;
    };

export type StepArgs<C, S extends string, Input> = {
  step: S;
  context: Readonly<C>;
  input: Input | undefined;
  updateContext: (fn: (draft: C) => void) => void;
};

export type StepEnterArgs<C, S extends string, Input> =
  StepArgs<C, S, Input> & { from: S | null };

export type StepExitArgs<C, S extends string, Input> =
  StepArgs<C, S, Input> & { to: S | null };

export type StepRunArgs<C, S extends string, Input> =
  StepArgs<C, S, Input> & {
    attempt: number;
    signal?: CancellationSignal;
  };

export type StepNextArgs<C, S extends string, Input, Output> =
  StepArgs<C, S, Input> & {
    output: Output | undefined;
    history: readonly FlowEvent<S>[];
  };

export type StepCompensateArgs<C, S extends string, Input, Output> =
  StepArgs<C, S, Input> & {
    output: Output | undefined;
    reason?: string;
  };

export type StepDefinition<
  C,
  S extends string,
  Input,
  Output = Input,
  E = unknown
> = {
  kind?: StepKind;
  runtime?: StepRuntime;
  durability?: StepDurability;
  dependsOn?: readonly S[];

  initial?: Input;

  run?: (args: StepRunArgs<C, S, Input>) => Output | Promise<Output>;

  next?:
    | TransitionDecision<S>
    | ((
        args: StepNextArgs<C, S, Input, Output>
      ) => TransitionDecision<S> | Promise<TransitionDecision<S>>);

  enter?: (
    args: StepEnterArgs<C, S, Input>
  ) => void | Partial<Input> | Promise<void | Partial<Input>>;

  exit?: (args: StepExitArgs<C, S, Input>) => void | Promise<void>;

  canEnter?: (args: StepEnterArgs<C, S, Input>) => boolean | Promise<boolean>;
  canExit?: (args: StepExitArgs<C, S, Input>) => boolean | Promise<boolean>;

  validate?: (args: { context: Readonly<C>; data: Input }) => void | Promise<void>;

  compensate?: (
    args: StepCompensateArgs<C, S, Input, Output>
  ) => void | Promise<void>;

  retry?: RetryPolicy;
  timeoutMs?: number;
  idempotencyKey?: (args: StepRunArgs<C, S, Input>) => string;

  required?: boolean | ((args: { context: Readonly<C>; data: Input | undefined }) => boolean);

  complete?: boolean | ((args: { context: Readonly<C>; data: Input | undefined }) => boolean);

  meta?: {
    label?: string;
    hidden?: boolean;
    [k: string]: unknown;
  };

  error?: E;
};

export type AnyStepRecord<C> = Record<
  string,
  StepDefinition<C, string, unknown, unknown, unknown>
>;

type ExtractRunReturn<TDef> = TDef extends { run: (...args: unknown[]) => infer R }
  ? Awaited<R>
  : never;

export type InferStepInput<TDef> = TDef extends { initial: infer D }
  ? D
  : TDef extends { validate: (args: { data: infer D }) => unknown }
    ? D
    : TDef extends { run: (args: { input: infer D }) => unknown }
      ? D
      : unknown;

export type InferStepOutput<TDef> = [ExtractRunReturn<TDef>] extends [never]
  ? InferStepInput<TDef>
  : ExtractRunReturn<TDef>;

export type InferStepError<TDef> = TDef extends { error: infer E } ? E : unknown;

export type StepInputMap<TSteps extends Record<string, unknown>> = {
  [K in StepId<TSteps>]: InferStepInput<TSteps[K]>;
};

export type StepOutputMap<TSteps extends Record<string, unknown>> = {
  [K in StepId<TSteps>]: InferStepOutput<TSteps[K]>;
};

export type StepErrorMap<TSteps extends Record<string, unknown>> = {
  [K in StepId<TSteps>]: InferStepError<TSteps[K]>;
};

type RequireNext<TDef extends { next?: unknown }> = Omit<TDef, 'next'> & {
  next: Exclude<TDef['next'], undefined>;
};

type KindedStep<
  TDef extends StepDefinition<unknown, string, unknown, unknown, unknown>,
  K extends StepKind
> = Omit<TDef, 'kind'> & { kind: K };

function withKind<
  const K extends StepKind,
  const TDef extends StepDefinition<unknown, string, unknown, unknown, unknown>
>(kind: K, definition: Omit<TDef, 'kind'>): KindedStep<TDef, K> {
  return {
    ...definition,
    kind,
  } as KindedStep<TDef, K>;
}

export function step<
  const T extends StepDefinition<unknown, string, unknown, unknown, unknown>
>(definition: T): T {
  return definition;
}

export function view<
  const T extends StepDefinition<unknown, string, unknown, unknown, unknown>
>(definition: Omit<T, 'kind'>): KindedStep<T, 'view'> {
  return withKind('view', definition);
}

export function action<
  const T extends StepDefinition<unknown, string, unknown, unknown, unknown>
>(definition: Omit<T, 'kind'>): KindedStep<T, 'action'> {
  return withKind('action', definition);
}

export function gate<
  const T extends StepDefinition<unknown, string, unknown, unknown, unknown>
>(definition: Omit<T, 'kind'>): KindedStep<T, 'gate'> {
  return withKind('gate', definition);
}

export function final<
  const T extends StepDefinition<unknown, string, unknown, unknown, unknown>
>(definition: Omit<RequireNext<T>, 'kind'>): KindedStep<RequireNext<T>, 'final'> {
  return withKind('final', definition);
}

export function defineSteps<
  const TSteps extends Record<
    string,
    StepDefinition<unknown, string, unknown, unknown, unknown>
  >
>(steps: TSteps): TSteps {
  return steps;
}

export type StepSnapshot<
  C,
  S extends string,
  Input,
  Output,
  E = unknown
> = {
  step: S;
  kind: StepKind;
  runtime: StepRuntime;
  durability: StepDurability;
  status: StepStatus;

  dependsOn: readonly S[];

  input: Input | undefined;
  output: Output | undefined;
  error: E | undefined;

  attempts: number;
  startedAt: number | null;
  finishedAt: number | null;
  timeoutMs: number | null;
  lastIdempotencyKey: string | null;

  meta?: {
    label?: string;
    hidden?: boolean;
    [k: string]: unknown;
  };
};

export type OrchestratorState<C, TSteps extends AnyStepRecord<C>> = {
  mode: ExecutionMode;
  status: RuntimeStatus;

  current: StepId<TSteps> | null;
  active: readonly StepId<TSteps>[];

  context: C;

  steps: {
    [K in StepId<TSteps>]: StepSnapshot<
      C,
      K,
      StepInputMap<TSteps>[K],
      StepOutputMap<TSteps>[K],
      StepErrorMap<TSteps>[K]
    >;
  };

  history: readonly FlowEvent<StepId<TSteps>>[];

  saga: {
    stack: readonly StepId<TSteps>[];
    compensated: readonly StepId<TSteps>[];
  };

  persistence: PersistenceRuntimeState;

  isTransitioning: boolean;
  version: number;
};

export type OrchestratorSnapshot<C, TSteps extends AnyStepRecord<C>> = {
  state: OrchestratorState<C, TSteps>;
  persistedAt: number;
};

export type PersistenceAdapter<C, TSteps extends AnyStepRecord<C>> = {
  load: () => Promise<OrchestratorSnapshot<C, TSteps> | null>;
  save: (snapshot: OrchestratorSnapshot<C, TSteps>) => Promise<void>;
  clear?: () => Promise<void>;
};

export type PersistenceConfig<C, TSteps extends AnyStepRecord<C>> = {
  adapter: PersistenceAdapter<C, TSteps>;
  key?: string;
  autoLoad?: boolean;
  autoSave?: PersistenceAutoSave;
  clearOnFinal?: boolean;
  debounceMs?: number;
  redact?: (
    snapshot: OrchestratorSnapshot<C, TSteps>
  ) => OrchestratorSnapshot<C, TSteps>;
};

export type PersistenceRuntimeState = {
  enabled: boolean;
  key: string | null;
  autoLoad: boolean;
  autoSave: PersistenceAutoSave;
  clearOnFinal: boolean;
  status: PersistenceStatus;
  lastSavedAt: number | null;
  lastLoadedAt: number | null;
  lastError: unknown;
};

export type OrchestratorRuntime<C, TSteps extends AnyStepRecord<C>> = {
  readonly state: OrchestratorState<C, TSteps>;

  readonly __types?: {
    step: StepId<TSteps>;
    context: C;
    input: StepInputMap<TSteps>;
    output: StepOutputMap<TSteps>;
    error: StepErrorMap<TSteps>;
  };

  current(): StepId<TSteps> | null;
  context(): Readonly<C>;

  step<K extends StepId<TSteps>>(step: K): OrchestratorState<C, TSteps>['steps'][K];
  input<K extends StepId<TSteps>>(step: K): StepInputMap<TSteps>[K] | undefined;
  output<K extends StepId<TSteps>>(step: K): StepOutputMap<TSteps>[K] | undefined;
  error<K extends StepId<TSteps>>(step: K): StepErrorMap<TSteps>[K] | undefined;

  setInput<K extends StepId<TSteps>>(step: K, value: StepInputMap<TSteps>[K]): void;

  patchInput<K extends StepId<TSteps>>(
    step: K,
    patch: Partial<StepInputMap<TSteps>[K]>
  ): void;

  updateContext(fn: (draft: C) => void): void;

  canGo<K extends StepId<TSteps>>(step: K): Promise<boolean>;

  go<K extends StepId<TSteps>>(step: K, opts?: { reason?: string }): Promise<K>;
  next(): Promise<StepId<TSteps> | null>;
  back(): Promise<StepId<TSteps> | null>;

  runReady(opts?: { concurrency?: number }): Promise<readonly StepId<TSteps>[]>;

  runStep<K extends StepId<TSteps>>(
    step: K
  ): Promise<StepOutputMap<TSteps>[K] | undefined>;

  retry<K extends StepId<TSteps>>(step: K): Promise<void>;

  compensate(opts?: { from?: StepId<TSteps>; reason?: string }): Promise<void>;

  snapshot(): OrchestratorSnapshot<C, TSteps>;
  resume(snapshot: OrchestratorSnapshot<C, TSteps>): Promise<void>;
  loadPersisted(): Promise<boolean>;
  savePersisted(): Promise<void>;
  clearPersisted(): Promise<void>;

  reset(opts?: { hard?: boolean }): void;

  subscribe(listener: (state: OrchestratorState<C, TSteps>) => void): () => void;

  subscribeEvents(listener: (event: FlowEvent<StepId<TSteps>>) => void): () => void;
};

export type FlowDefinition<C, TSteps extends AnyStepRecord<C>> = {
  mode?: ExecutionMode;
  context: C;
  steps: TSteps;
  start?: StepId<TSteps> | readonly StepId<TSteps>[];
  final?: readonly StepId<TSteps>[];
  maxConcurrency?: number;
  persistence?: PersistenceConfig<C, TSteps>;
};

export type CreateOrchestratorOptions<C, TSteps extends AnyStepRecord<C>> =
  FlowDefinition<C, TSteps> & { now?: () => number };

export function defineFlow<
  C,
  const TSteps extends AnyStepRecord<C>,
  const TFlow extends FlowDefinition<C, TSteps>
>(flow: TFlow): TFlow {
  return flow;
}

export declare function createOrchestrator<
  C,
  const TSteps extends AnyStepRecord<C>
>(opts: CreateOrchestratorOptions<C, TSteps>): OrchestratorRuntime<C, TSteps>;

export type CreateWizardOptions<C, TSteps extends AnyStepRecord<C>> = Omit<
  CreateOrchestratorOptions<C, TSteps>,
  'mode'
>;

export declare function createWizard<
  C,
  const TSteps extends AnyStepRecord<C>
>(opts: CreateWizardOptions<C, TSteps>): OrchestratorRuntime<C, TSteps>;
