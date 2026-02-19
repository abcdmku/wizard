/**
 * @wizard/core - Core Types
 * Server-safe isomorphic types with inference-first authoring.
 */

import { Store } from '@tanstack/store';
import type { WizardStep } from './step-wrapper';

// ===== 1. Utility Types & Resolvers =====

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JSONValue }
  | JSONValue[];

export type ValOrFn<T, A> = T | ((args: A) => T);

/**
 * NOTE:
 * The cast is required because TypeScript cannot safely narrow callable union members
 * when T itself may be callable.
 */
export const resolve = <T, A>(v: ValOrFn<T, A>, a: A): T =>
  typeof v === 'function' ? (v as (args: A) => T)(a) : v;

// ===== 2. Callback Args =====

export type StepArgs<C, S extends string, Data, E> = {
  step: S;
  context: Readonly<C>;
  data: Readonly<Data> | undefined;
  updateContext: (fn: (context: C) => void) => void;
  setStepData: (data: Data) => void;
  emit: (event: E) => void;
  getAllStepNames: () => readonly S[];
};

export type StepEnterArgs<C, S extends string, Data, E> =
  StepArgs<C, S, Data, E> & { from?: S | null };

export type StepExitArgs<C, S extends string, Data, E> =
  StepArgs<C, S, Data, E> & { to?: S | null };

export type ValidateArgs<C, Data = unknown> = {
  context: Readonly<C>;
  data: Data;
};

// ===== 3. Server-safe Meta =====

export type StepMetaCore<C, S extends string, Data, E> = {
  id?: string;
  label?: ValOrFn<string, StepArgs<C, S, Data, E>>;
  shortLabel?: ValOrFn<string, StepArgs<C, S, Data, E>>;
  description?: ValOrFn<string, StepArgs<C, S, Data, E>>;
  tooltip?: ValOrFn<string, StepArgs<C, S, Data, E>>;
  iconKey?: ValOrFn<string, StepArgs<C, S, Data, E>>;
  category?: ValOrFn<string, StepArgs<C, S, Data, E>>;
  tags?: ValOrFn<readonly string[], StepArgs<C, S, Data, E>>;
  hidden?: ValOrFn<boolean, StepArgs<C, S, Data, E>>;
  docsUrl?: string;
  ariaLabel?: ValOrFn<string, StepArgs<C, S, Data, E>>;
  extra?: Record<string, JSONValue>;
};

export function resolveMetaCore<C, S extends string, Data, E>(
  meta: StepMetaCore<C, S, Data, E> | undefined,
  args: StepArgs<C, S, Data, E>
) {
  const r = <T>(v: ValOrFn<T, typeof args> | undefined, d: T): T =>
    typeof v === 'function' ? (v as (a: typeof args) => T)(args) : (v ?? d);

  return {
    id: meta?.id ?? args.step,
    label: r(meta?.label, args.step),
    shortLabel: r(meta?.shortLabel, r(meta?.label, args.step)),
    description: r(meta?.description, ''),
    tooltip: r(meta?.tooltip, ''),
    iconKey: r(meta?.iconKey, ''),
    category: r(meta?.category, ''),
    tags: r(meta?.tags, [] as readonly string[]),
    hidden: r(meta?.hidden, false),
    docsUrl: meta?.docsUrl ?? '',
    ariaLabel: r(meta?.ariaLabel, r(meta?.label, args.step)),
    extra: meta?.extra ?? {},
  };
}

// ===== 4. Status Vocabulary =====

export type StepStatus =
  | 'unavailable'
  | 'optional'
  | 'current'
  | 'completed'
  | 'required'
  | 'skipped'
  | 'error'
  | 'terminated'
  | 'loading';

// ===== 5. Step Definitions =====

export type StepDefinition<C, S extends string, Data, E = never> = {
  next?:
    | readonly S[]
    | 'any'
    | ((args: StepArgs<C, S, Data, E>) => S | readonly S[] | 'any');
  data?: ValOrFn<Data, StepEnterArgs<C, S, Data, E>>;

  beforeEnter?: (
    args: StepEnterArgs<C, S, Data, E>
  ) =>
    | void
    | Partial<Data>
    | Data
    | Promise<void | Partial<Data> | Data>;

  validate?: (args: ValidateArgs<C, Data>) => void;

  complete?: ValOrFn<boolean, StepArgs<C, S, Data, E>>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<C, S, Data, E>>;
  canExit?: ValOrFn<boolean, StepExitArgs<C, S, Data, E>>;

  beforeExit?: (args: StepExitArgs<C, S, Data, E>) => void | Promise<void>;

  weight?: ValOrFn<number, StepArgs<C, S, Data, E>>;
  required?: ValOrFn<boolean, StepArgs<C, S, Data, E>>;
  maxRetries?: ValOrFn<number, StepArgs<C, S, Data, E>>;
  retryDelay?: ValOrFn<number, StepArgs<C, S, Data, E>>;
  prerequisites?: readonly S[];

  meta?: StepMetaCore<C, S, Data, E>;
};

// ===== 6. Data Inference =====

export declare const DATA_BRAND: unique symbol;
export type WithDataBrand<Data> = { readonly [DATA_BRAND]: Data };
export declare const ERROR_BRAND: unique symbol;
export type WithErrorBrand<Error> = { readonly [ERROR_BRAND]: Error };

type FnValue<T> = T extends (...args: any[]) => infer R ? R : T;

/**
 * Unified step data extraction priority:
 * 1) explicit brand from step()/factory helpers
 * 2) validate callback args
 * 3) data field value/function
 * 4) unknown
 */
export type DataTypeOf<TDef> =
  TDef extends WithDataBrand<infer Branded>
    ? Branded
    : TDef extends { validate: (args: ValidateArgs<any, infer VD>) => any }
      ? VD
      : TDef extends { validate: (args: { context: any; data: infer VD }) => any }
        ? VD
        : TDef extends { data?: infer D }
          ? FnValue<D>
          : unknown;

export type InferStepData<TDef> = DataTypeOf<TDef>;
export type ErrorTypeOf<TDef, Fallback = unknown> =
  TDef extends WithErrorBrand<infer BrandedError> ? BrandedError : Fallback;

export type PartialStepDefinition<C, S extends string, E, TDef> = {
  next?:
    | readonly S[]
    | 'any'
    | ((args: StepArgs<C, S, InferStepData<TDef>, E>) => S | readonly S[] | 'any');
  data?: ValOrFn<InferStepData<TDef>, StepEnterArgs<C, S, InferStepData<TDef>, E>>;
  beforeEnter?: (
    args: StepEnterArgs<C, S, InferStepData<TDef>, E>
  ) =>
    | void
    | Partial<InferStepData<TDef>>
    | InferStepData<TDef>
    | Promise<void | Partial<InferStepData<TDef>> | InferStepData<TDef>>;
  validate?: (args: ValidateArgs<C, InferStepData<TDef>>) => void;
  complete?: ValOrFn<boolean, StepArgs<C, S, InferStepData<TDef>, E>>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<C, S, InferStepData<TDef>, E>>;
  canExit?: ValOrFn<boolean, StepExitArgs<C, S, InferStepData<TDef>, E>>;
  beforeExit?: (
    args: StepExitArgs<C, S, InferStepData<TDef>, E>
  ) => void | Promise<void>;
  weight?: ValOrFn<number, StepArgs<C, S, InferStepData<TDef>, E>>;
  required?: ValOrFn<boolean, StepArgs<C, S, InferStepData<TDef>, E>>;
  maxRetries?: ValOrFn<number, StepArgs<C, S, InferStepData<TDef>, E>>;
  retryDelay?: ValOrFn<number, StepArgs<C, S, InferStepData<TDef>, E>>;
  meta?: StepMetaCore<C, S, InferStepData<TDef>, E>;
};

export type StepIds<T> = keyof T & string;
export type DataMapFromDefs<TDefs> = {
  [K in keyof TDefs & string]: DataTypeOf<TDefs[K]>;
};
export type ErrorMapFromDefs<TDefs, DefaultError = unknown> = {
  [K in keyof TDefs & string]: ErrorTypeOf<TDefs[K], DefaultError>;
};

// Kept as alias for compatibility.
export type EnhancedDataMapFromDefs<TDefs> = DataMapFromDefs<TDefs>;

export function defineSteps<const T extends Record<string, any>>(defs: T): T {
  return defs;
}

// ===== 7. Wizard State + Helpers =====

export type WizardState<
  C,
  S extends string,
  D extends Record<S, unknown>,
  EM extends Record<S, unknown> = Record<S, unknown>
> = {
  step: S;
  context: C;
  data: Partial<D>;
  meta: Partial<Record<S, StepMetaCore<C, S, unknown, never>>>;
  errors: Partial<{ [K in S]: EM[K] }>;
  history: Array<{ step: S; context: C; data: Partial<D> }>;
  isLoading: boolean;
  isTransitioning: boolean;
  runtime?: Partial<
    Record<
      S,
      {
        status?: StepStatus;
        attempts?: number;
        startedAt?: number;
        finishedAt?: number;
      }
    >
  >;
};

export type WizardHelpers<
  C,
  S extends string,
  D extends Record<S, unknown>,
  EM extends Record<S, unknown> = Record<S, unknown>
> = {
  allStepNames(): readonly S[];
  orderedStepNames(): readonly S[];
  availableStepNames(): readonly S[];
  unavailableStepNames(): readonly S[];
  completedStepNames(): readonly S[];
  remainingStepNames(): readonly S[];

  allSteps(): ReadonlyArray<WizardStep<S, D[S], C, S, D, EM>>;
  orderedSteps(): ReadonlyArray<WizardStep<S, D[S], C, S, D, EM>>;
  availableSteps(): ReadonlyArray<WizardStep<S, D[S], C, S, D, EM>>;
  unavailableSteps(): ReadonlyArray<WizardStep<S, D[S], C, S, D, EM>>;
  completedSteps(): ReadonlyArray<WizardStep<S, D[S], C, S, D, EM>>;
  remainingSteps(): ReadonlyArray<WizardStep<S, D[S], C, S, D, EM>>;

  stepCount(): number;
  stepIndex(step: S): number;
  currentIndex(): number;

  stepStatus(step: S): StepStatus;
  isOptional(step: S): boolean;
  isRequired(step: S): boolean;

  refreshAvailability(): Promise<void>;

  firstIncompleteStep(): WizardStep<S, D[S], C, S, D, EM> | null;
  lastCompletedStep(): WizardStep<S, D[S], C, S, D, EM> | null;
  firstIncompleteStepName(): S | null;
  lastCompletedStepName(): S | null;

  remainingRequiredCount(): number;
  isComplete(): boolean;
  progress(): { ratio: number; percent: number; label: string };

  canGoNext(): boolean;
  canGoBack(): boolean;
  canGoTo(step: S): boolean;
  findNextAvailable(from?: S): WizardStep<S, D[S], C, S, D, EM> | null;
  findPrevAvailable(from?: S): WizardStep<S, D[S], C, S, D, EM> | null;
  findNextAvailableName(from?: S): S | null;
  findPrevAvailableName(from?: S): S | null;
  jumpToNextRequired(): WizardStep<S, D[S], C, S, D, EM> | null;
  jumpToNextRequiredName(): S | null;

  isReachable(step: S): boolean;
  prerequisitesFor(step: S): readonly S[];
  successorsOf(step: S): readonly S[];

  stepAttempts(step: S): number;
  stepDuration(step: S): number | null;

  percentCompletePerStep(): Record<S, number>;
  snapshot(): WizardState<C, S, D, EM>;
};

export type Wizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  _E,
  EM extends Record<S, unknown> = Record<S, unknown>
> = {
  store: Store<WizardState<C, S, D, EM>>;

  readonly step: S;
  readonly context: Readonly<C>;
  readonly data: Partial<D>;
  readonly meta: Partial<Record<S, StepMetaCore<C, S, unknown, never>>>;
  readonly errors: Partial<{ [K in S]: EM[K] }>;
  readonly history: Array<{ step: S; context: C; data: Partial<D> }>;
  readonly isLoading: boolean;
  readonly isTransitioning: boolean;
  readonly runtime?: Partial<
    Record<
      S,
      { status?: StepStatus; attempts?: number; startedAt?: number; finishedAt?: number }
    >
  >;

  next(args?: { data?: D[S] }): Promise<WizardStep<S, D[S], C, S, D, EM>>;
  goTo<K extends S>(
    step: K,
    args?: { data?: D[K] }
  ): Promise<WizardStep<K, D[K], C, S, D, EM>>;
  back(): Promise<WizardStep<S, D[S], C, S, D, EM>>;
  reset(): void;

  updateContext(fn: (context: C) => void): void;
  setStepData<K extends S>(step: K, data: D[K]): void;
  updateStepData<K extends S>(
    step: K,
    updater: Partial<D[K]> | ((current: D[K] | undefined) => Partial<D[K]>)
  ): void;
  getStepData<K extends S>(step: K): D[K] | undefined;
  setStepMeta<K extends S>(step: K, meta: StepMetaCore<C, S, D[K], never>): void;
  updateStepMeta<K extends S>(
    step: K,
    updater:
      | Partial<StepMetaCore<C, S, D[K], never>>
      | ((current: StepMetaCore<C, S, D[K], never> | undefined) => Partial<StepMetaCore<C, S, D[K], never>>)
  ): void;
  getStepMeta<K extends S>(step: K): StepMetaCore<C, S, D[K], never> | undefined;
  getStepError<K extends S>(step: K): EM[K] | undefined;
  getAllErrors(): Partial<{ [K in S]: EM[K] }>;
  clearStepError<K extends S>(step: K): void;
  clearAllErrors(): void;
  getContext(): Readonly<C>;
  getCurrent(): { step: S; data: Readonly<D[S]> | undefined; context: Readonly<C> };

  getStep<K extends S>(step: K): WizardStep<K, D[K], C, S, D, EM>;
  getCurrentStep(): WizardStep<S, D[S], C, S, D, EM>;

  markError<K extends S>(step: K, err: EM[K]): WizardStep<K, D[K], C, S, D, EM>;
  markTerminated<K extends S>(step: K, err?: EM[K]): WizardStep<K, D[K], C, S, D, EM>;
  markLoading<K extends S>(step: K): WizardStep<K, D[K], C, S, D, EM>;
  markIdle<K extends S>(step: K): WizardStep<K, D[K], C, S, D, EM>;
  markSkipped<K extends S>(step: K): WizardStep<K, D[K], C, S, D, EM>;

  helpers: WizardHelpers<C, S, D, EM>;
};

// ===== 8. Factory typing =====

export type CreateWizardOptions<C, _E, TDefs extends Record<string, any>> = {
  context: C;
  steps: TDefs;
  order?: readonly (keyof TDefs & string)[];
  onStatusChange?: (a: {
    step: keyof TDefs & string;
    prev?: StepStatus;
    next: StepStatus;
  }) => void;
};

export declare function createWizard<
  C,
  E,
  const TDefs extends Record<string, any>,
  DefaultError = unknown
>(
  opts: CreateWizardOptions<C, E, TDefs>
): Wizard<
  C,
  StepIds<TDefs>,
  DataMapFromDefs<TDefs>,
  E,
  ErrorMapFromDefs<TDefs, DefaultError>
>;

// ===== 9. Compatibility Layer =====

export type WizardConfig<C, S extends string, D extends Record<S, unknown>, E = never> = {
  steps: Record<S, StepDefinition<C, S, D[S], E>>;
  order?: readonly S[];
  weights?: Partial<Record<S, number>>;
  prerequisites?: Partial<Record<S, readonly S[]>>;
  isStepComplete?: (a: { step: S; data: Partial<D>; context: Readonly<C> }) => boolean;
  isOptional?: (step: S, context: Readonly<C>) => boolean;
  isRequired?: (step: S, context: Readonly<C>) => boolean;
  onStatusChange?: (a: { step: S; prev?: StepStatus; next: StepStatus }) => void;
};

export type WizardCreateOptions<C, E, TDefs extends Record<string, any>> =
  CreateWizardOptions<C, E, TDefs>;

export type WizardTransitionEvent = {
  step: string;
  prev?: StepStatus;
  next: StepStatus;
};

export type InferContext<T> = T extends { context: infer C } ? C : unknown;
export type InferSteps<T> = T extends { steps: infer S } ? keyof S & string : string;
export type InferDataMap<T> = T extends { steps: infer S } ? DataMapFromDefs<S> : Record<string, unknown>;

export type StepRuntime = {
  status?: StepStatus;
  attempts?: number;
  startedAt?: number;
  finishedAt?: number;
};

export type WizardPersistence<T = any> = {
  save: (key: string, value: T) => void | Promise<void>;
  load: (key: string) => T | null | Promise<T | null>;
  remove: (key: string) => void | Promise<void>;
};

// ===== 10. Enhanced Wizard alias =====

export type EnhancedWizard<
  C,
  S extends string,
  D extends Record<S, unknown>,
  E,
  EM extends Record<S, unknown> = Record<S, unknown>
> = Wizard<C, S, D, E, EM>;

export type EnhancedWizardFactory<C, DefaultError = unknown, E = never> = {
  defineSteps<T extends Record<string, any>>(defs: T): T;
  step(definition: any): any;
  createWizard<TDefs extends Record<string, any>>(
    context: C,
    steps: TDefs,
    options?: Omit<CreateWizardOptions<C, E, TDefs>, 'context' | 'steps'>
  ): EnhancedWizard<
    C,
    keyof TDefs & string,
    DataMapFromDefs<TDefs>,
    E,
    ErrorMapFromDefs<TDefs, DefaultError>
  >;
};
