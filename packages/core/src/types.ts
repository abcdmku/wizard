/**
 * @wizard/core - Core Types
 * Server-safe isomorphic types with inference-first authoring
 */

import { Store } from '@tanstack/store';

// ===== 1. Utility Types & Resolvers =====

export type JSONValue =
  | string | number | boolean | null
  | { [k: string]: JSONValue }
  | JSONValue[];

export type ValOrFn<T, A> = T | ((args: A) => T);

export const resolve = <T, A>(v: ValOrFn<T, A>, a: A): T =>
  typeof v === 'function' ? (v as any)(a) : v;

// ===== 2. Callback Args (use inferred Data) =====

export type StepArgs<C, S extends string, Data, E> = {
  step: S;
  context: Readonly<C>;
  data: Readonly<Data> | undefined;
  updateContext: (fn: (context: C) => void) => void;
  setStepData: (data: Data) => void;
  emit: (event: E) => void;
};

export type StepEnterArgs<C, S extends string, Data, E> =
  StepArgs<C, S, Data, E> & { from?: S | null };

export type StepExitArgs<C, S extends string, Data, E> =
  StepArgs<C, S, Data, E> & { to?: S | null };

export type ValidateArgs<C> = {
  context: Readonly<C>;
  data: unknown; // to be narrowed by validate
};

// ===== 3. Server-Safe Meta (core) + Resolver =====

export type StepMetaCore<C, S extends string, Data, E> = {
  id?: string;
  label?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  shortLabel?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  description?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  tooltip?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  iconKey?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  category?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  tags?: ValOrFn<readonly string[], StepArgs<C,S,Data,E>>;
  hidden?: ValOrFn<boolean, StepArgs<C,S,Data,E>>;
  docsUrl?: string;
  ariaLabel?: ValOrFn<string, StepArgs<C,S,Data,E>>;
  extra?: Record<string, JSONValue>;
};

export function resolveMetaCore<C,S extends string,Data,E>(
  meta: StepMetaCore<C,S,Data,E> | undefined,
  args: StepArgs<C,S,Data,E>
) {
  const r = <T>(v: ValOrFn<T, typeof args> | undefined, d: T): T =>
    (typeof v === 'function' ? (v as any)(args) : (v ?? d));
  return {
    id: meta?.id ?? args.step,
    label: r(meta?.label, args.step),
    shortLabel: r(meta?.shortLabel, r(meta?.label, args.step)),
    description: r(meta?.description, ''),
    tooltip: r(meta?.tooltip, ''),
    iconKey: r(meta?.iconKey, ''),
    category: r(meta?.category, ''),
    tags: r(meta?.tags as any, [] as string[]),
    hidden: r(meta?.hidden as any, false),
    docsUrl: meta?.docsUrl ?? '',
    ariaLabel: r(meta?.ariaLabel, r(meta?.label, args.step)),
    extra: meta?.extra ?? {},
  };
}

// ===== 4. Status Vocabulary =====

export type StepStatus =
  | 'unavailable'  // guards/prereqs fail
  | 'optional'     // meta classification
  | 'current'      // active
  | 'completed'    // success
  | 'required'     // meta classification
  | 'skipped'      // intentionally bypassed
  | 'error'        // retryable failure
  | 'terminated'   // terminal failure
  | 'loading';     // async in progress

// ===== 5. Step Definition (value-or-fn, typed via inference) =====

export type StepDefinition<C,S extends string,Data,E = never> = {
  next: readonly S[] | ((args: StepArgs<C,S,Data,E>) => S | readonly S[]);
  data?: ValOrFn<Data, StepEnterArgs<C,S,Data,E>>;

  beforeEnter?: (
    args: StepEnterArgs<C,S,Data,E>
  ) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;

  validate?: (args: ValidateArgs<C>) => void;

  complete?: ValOrFn<boolean, StepArgs<C,S,Data,E>>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<C,S,Data,E>>;
  canExit?: ValOrFn<boolean, StepExitArgs<C,S,Data,E>>;

  beforeExit?: (args: StepExitArgs<C,S,Data,E>) => void | Promise<void>;

  weight?: ValOrFn<number, StepArgs<C,S,Data,E>>;
  required?: ValOrFn<boolean, StepArgs<C,S,Data,E>>;
  maxRetries?: ValOrFn<number, StepArgs<C,S,Data,E>>;
  retryDelay?: ValOrFn<number, StepArgs<C,S,Data,E>>; // ms

  meta?: StepMetaCore<C,S,Data,E>;
};

// ===== 6. Inference Engine (defineSteps → infer Data per step) =====

// Infer Data from validate() → beforeEnter() return → data initializer
type InferFromValidate<TDef> =
  TDef extends { validate: (args: { data: infer Data }) => any }
    ? Data
    : never;

type InferFromBeforeEnter<TDef> =
  TDef extends { beforeEnter: (...args: any[]) => infer R | Promise<infer R> }
    ? R extends void
      ? never
      : R extends Partial<infer D>
        ? D
        : R
    : never;

type InferFromData<TDef> =
  TDef extends { data: infer D }
    ? D extends ValOrFn<infer X, any>
      ? X
      : D
    : never;

// IMPROVED: Better union handling with priority-based selection
export type InferStepData<TDef> =
  InferFromValidate<TDef> extends never
    ? InferFromBeforeEnter<TDef> extends never
      ? InferFromData<TDef> extends never
        ? unknown  // Fallback to unknown if no inference possible
        : InferFromData<TDef>
      : InferFromBeforeEnter<TDef>
    : InferFromValidate<TDef>;

// Authoring surface (callbacks see inferred Data)
export type PartialStepDefinition<C,S extends string,E,TDef> = {
  next: readonly S[] | ((args: StepArgs<C,S,InferStepData<TDef>,E>) => S | readonly S[]);
  data?: ValOrFn<InferStepData<TDef>, StepEnterArgs<C,S,InferStepData<TDef>,E>>;
  beforeEnter?: (
    args: StepEnterArgs<C,S,InferStepData<TDef>,E>
  ) => void | Partial<InferStepData<TDef>> | InferStepData<TDef> | Promise<void | Partial<InferStepData<TDef>> | InferStepData<TDef>>;
  validate?: (args: ValidateArgs<C>) => void;
  complete?: ValOrFn<boolean, StepArgs<C,S,InferStepData<TDef>,E>>;
  canEnter?: ValOrFn<boolean, StepEnterArgs<C,S,InferStepData<TDef>,E>>;
  canExit?: ValOrFn<boolean, StepExitArgs<C,S,InferStepData<TDef>,E>>;
  beforeExit?: (args: StepExitArgs<C,S,InferStepData<TDef>,E>) => void | Promise<void>;
  weight?: ValOrFn<number, StepArgs<C,S,InferStepData<TDef>,E>>;
  required?: ValOrFn<boolean, StepArgs<C,S,InferStepData<TDef>,E>>;
  maxRetries?: ValOrFn<number, StepArgs<C,S,InferStepData<TDef>,E>>;
  retryDelay?: ValOrFn<number, StepArgs<C,S,InferStepData<TDef>,E>>;
  meta?: StepMetaCore<C,S,InferStepData<TDef>,E>;
};

export type StepIds<T> = keyof T & string;
export type DataMapFromDefs<TDefs> = { [K in keyof TDefs & string]: InferStepData<TDefs[K]> };

// ===== 6.5. Advanced Type Transformation for Callback Inference =====



// FINAL FIX: Direct approach using intersection types and proper data extraction

// Extract data type from step definition
type ExtractDataType<T> =
  T extends { validate: (args: { data: infer D }) => any }
    ? D
    : T extends { data: infer D }
      ? D
      : unknown;

// Define properly typed step args for callbacks
type TypedStepArgs<StepName extends string, Data, Context = unknown> = {
  step: StepName;
  context: Readonly<Context>;
  data: Readonly<Data>;
  updateContext: (fn: (context: Context) => void) => void;
  setStepData: (data: Data) => void;
  emit: (event: never) => void;
};

type TypedStepEnterArgs<StepName extends string, Data, Context = unknown> = TypedStepArgs<StepName, Data, Context> & {
  from?: StepName | null;
};

type TypedStepExitArgs<StepName extends string, Data, Context = unknown> = TypedStepArgs<StepName, Data, Context> & {
  to?: StepName | null;
};

// The ACTUAL fix: overload defineSteps to directly type the input properly
export function defineSteps<T extends Record<string, any>>(defs: T): {
  [K in keyof T]: T[K] extends {
    data: infer Data;
    validate?: (args: { data: infer ValidateData }) => any;
  } ? T[K] & {
    beforeExit?: (args: TypedStepExitArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => void | Promise<void>;
    beforeEnter?: (args: TypedStepEnterArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => void | Partial<T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data> | (T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data) | Promise<void | Partial<T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data> | (T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data)>;
    canEnter?: boolean | ((args: TypedStepEnterArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => boolean);
    canExit?: boolean | ((args: TypedStepExitArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => boolean);
    complete?: boolean | ((args: TypedStepArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => boolean);
    weight?: number | ((args: TypedStepArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => number);
    required?: boolean | ((args: TypedStepArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => boolean);
    maxRetries?: number | ((args: TypedStepArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => number);
    retryDelay?: number | ((args: TypedStepArgs<K & string, T[K] extends { validate: (args: { data: infer VD }) => any } ? VD : Data>) => number);
  } : T[K]
} {
  return defs;
}


// ===== 7. Wizard State + Store + Helpers =====

export type WizardState<C,S extends string,D extends Record<S, unknown>> = {
  step: S;
  context: C;
  data: Partial<D>;
  errors: Partial<Record<S, unknown>>;
  history: Array<{ step: S; context: C; data: Partial<D> }>;
  isLoading: boolean;
  isTransitioning: boolean;
  runtime?: Partial<Record<S, {
    status?: StepStatus; attempts?: number; startedAt?: number; finishedAt?: number;
  }>>;
};

export type WizardHelpers<C,S extends string,D extends Record<S,unknown>> = {
  allSteps(): readonly S[];
  orderedSteps(): readonly S[];
  stepCount(): number;
  stepIndex(step: S): number;
  currentIndex(): number;

  stepStatus(step: S): StepStatus;
  isOptional(step: S): boolean;
  isRequired(step: S): boolean;

  availableSteps(): readonly S[];
  unavailableSteps(): readonly S[];
  refreshAvailability(): Promise<void>;

  completedSteps(): readonly S[];
  remainingSteps(): readonly S[];
  firstIncompleteStep(): S | null;
  lastCompletedStep(): S | null;
  remainingRequiredCount(): number;
  isComplete(): boolean;
  progress(): { ratio: number; percent: number; label: string };

  canGoNext(): boolean;
  canGoBack(): boolean;
  canGoTo(step: S): boolean;
  findNextAvailable(from?: S): S | null;
  findPrevAvailable(from?: S): S | null;
  jumpToNextRequired(): S | null;

  isReachable(step: S): boolean;
  prerequisitesFor(step: S): readonly S[];
  successorsOf(step: S): readonly S[];

  stepAttempts(step: S): number;
  stepDuration(step: S): number | null;

  percentCompletePerStep(): Record<S, number>;
  snapshot(): WizardState<C,S,D>;
};

export type Wizard<C,S extends string,D extends Record<S, unknown>,_E> = {
  store: Store<WizardState<C,S,D>>;
  next(args?: { data?: D[S] }): Promise<import('./step-wrapper').WizardStep<S, unknown, C, S, D>>;
  goTo<K extends S>(step: K, args?: { data?: D[K] }): Promise<import('./step-wrapper').WizardStep<K, D[K], C, S, D>>;
  back(): Promise<import('./step-wrapper').WizardStep<S, unknown, C, S, D>>;
  reset(): void;

  updateContext(fn: (context: C) => void): void;
  setStepData<K extends S>(step: K, data: D[K]): void;
  getStepData<K extends S>(step: K): D[K] | undefined;
  getContext(): Readonly<C>;
  getCurrent(): { step: S; data: Readonly<D[S]> | undefined; context: Readonly<C> };

  // Enhanced step access methods
  getStep<K extends S>(step: K): import('./step-wrapper').WizardStep<K, D[K], C, S, D>;
  getCurrentStep(): import('./step-wrapper').WizardStep<S, D[S], C, S, D>;

  markError<K extends S>(step: K, err: unknown): import('./step-wrapper').WizardStep<K, D[K], C, S, D>;
  markTerminated<K extends S>(step: K, err?: unknown): import('./step-wrapper').WizardStep<K, D[K], C, S, D>;
  markLoading<K extends S>(step: K): import('./step-wrapper').WizardStep<K, D[K], C, S, D>;
  markIdle<K extends S>(step: K): import('./step-wrapper').WizardStep<K, D[K], C, S, D>;
  markSkipped<K extends S>(step: K): import('./step-wrapper').WizardStep<K, D[K], C, S, D>;

  helpers: WizardHelpers<C,S,D>;
};

// ===== 8. Factory: createWizard (keeps inference) =====
// Implementation is in ./wizard.ts

export type CreateWizardOptions<C, _E, TDefs extends Record<string, any>> = {
  context: C;
  steps: TDefs;                   // from defineSteps()
  order?: readonly (keyof TDefs & string)[];
  onStatusChange?: (a: { step: keyof TDefs & string; prev?: StepStatus; next: StepStatus }) => void;
};

export declare function createWizard<C, E, TDefs extends Record<string, any>>(
  opts: CreateWizardOptions<C, E, TDefs>
): Wizard<C, StepIds<TDefs>, DataMapFromDefs<TDefs>, E>;

// ===== 9. Compatibility Layer - Legacy Type Exports =====

// Legacy 4-parameter WizardConfig for backward compatibility
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

// New API type alias for convenience
export type WizardCreateOptions<C, E, TDefs extends Record<string, any>> = CreateWizardOptions<C, E, TDefs>;
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

// ===== 10. Enhanced Wizard API with Fluent Interface =====

// Import step wrapper types
import type { WizardStep } from './step-wrapper';

// Type extraction utilities for proper step data inference
export type ExtractStepDataType<TDefs, StepName extends keyof TDefs> =
  TDefs[StepName] extends { validate: (args: { data: infer ValidateData }) => any }
    ? ValidateData
    : TDefs[StepName] extends { data: infer DataProp }
      ? DataProp extends ValOrFn<infer DataType, any>
        ? DataType
        : DataProp
      : TDefs[StepName] extends { beforeEnter: (...args: any[]) => infer ReturnType }
        ? ReturnType extends void ? never : ReturnType
        : unknown;

// Enhanced data map that preserves step-specific types
export type EnhancedDataMapFromDefs<TDefs> = {
  [K in keyof TDefs & string]: ExtractStepDataType<TDefs, K>;
};

/**
 * Enhanced Wizard interface that extends the base Wizard with fluent API capabilities
 */
export type EnhancedWizard<C, S extends string, D extends Record<S, unknown>, E> =
  Wizard<C, S, D, E> & {

  // Enhanced methods with proper return types
  getStep<K extends S>(step: K): WizardStep<K, D[K], C, S, D>;
  getCurrentStep(): WizardStep<S, D[S], C, S, D>;

  // Navigation methods that return step objects
  next(args?: { data?: D[S] }): Promise<WizardStep<S, unknown, C, S, D>>;
  goTo<K extends S>(step: K, args?: { data?: D[K] }): Promise<WizardStep<K, D[K], C, S, D>>;
  back(): Promise<WizardStep<S, unknown, C, S, D>>;

  // Enhanced data access with proper typing
  getStepData<K extends S>(step: K): D[K] | undefined;
  getCurrent(): { step: S; data: Readonly<D[S]> | undefined; context: Readonly<C> };

  // Fluent step operations
  markIdle<K extends S>(step: K): WizardStep<K, D[K], C, S, D>;
  markLoading<K extends S>(step: K): WizardStep<K, D[K], C, S, D>;
  markSkipped<K extends S>(step: K): WizardStep<K, D[K], C, S, D>;
  markError<K extends S>(step: K, err: unknown): WizardStep<K, D[K], C, S, D>;
  markTerminated<K extends S>(step: K, err?: unknown): WizardStep<K, D[K], C, S, D>;
};

// Factory function type for creating enhanced wizards
export type EnhancedWizardFactory<C, E = never> = {
  defineSteps<T extends Record<string, any>>(defs: T): T;
  step<Data>(definition: any): any;
  createWizard<TDefs extends Record<string, any>>(
    context: C,
    steps: TDefs,
    options?: Omit<CreateWizardOptions<C, E, TDefs>, 'context' | 'steps'>
  ): EnhancedWizard<C, keyof TDefs & string, EnhancedDataMapFromDefs<TDefs>, E>;
};

// Helper type for step creation with proper data inference
export type StepWithData<Data> = {
  data?: Data;
  next: readonly string[] | ((args: any) => string | readonly string[]);
  beforeExit?: (args: any) => void | Promise<void>;
  beforeEnter?: (args: any) => void | Partial<Data> | Data | Promise<void | Partial<Data> | Data>;
  canEnter?: boolean | ((args: any) => boolean);
  canExit?: boolean | ((args: any) => boolean);
  complete?: boolean | ((args: any) => boolean);
  validate?: (args: any) => void;
  weight?: number | ((args: any) => number);
  required?: boolean | ((args: any) => boolean);
  maxRetries?: number | ((args: any) => number);
  retryDelay?: number | ((args: any) => number);
  meta?: any;
};