/**
 * SOLUTION DESIGN: Proper type transformation for callback arguments
 */

// The key insight: We need to transform input definitions to proper PartialStepDefinition
// but handle the circular dependency between step names and data types

// Step 1: Input type (what users write)
type StepDefInput<S extends string = string> = {
  data?: any;
  validate?: (args: { data: any }) => void;
  beforeEnter?: (args: any) => any;
  beforeExit?: (args: any) => any;
  canEnter?: any;
  canExit?: any;
  complete?: any;
  next: readonly S[] | ((args: any) => S | readonly S[]);
  meta?: any;
  weight?: any;
  required?: any;
  maxRetries?: any;
  retryDelay?: any;
};

// Step 2: Transform each step definition to use proper constraints
type TransformStepDef<TDef, S extends string, AllSteps> = TDef extends StepDefInput<S> ? {
  // Keep the same structure but with proper typing
  data?: import('../types').InferStepData<TDef>;
  validate?: TDef['validate']; // Keep validate as-is since it's already properly typed
  beforeEnter?: TDef extends { beforeEnter: any }
    ? (args: import('../types').StepEnterArgs<unknown, S, import('../types').InferStepData<TDef>, never>) =>
        void | Partial<import('../types').InferStepData<TDef>> | import('../types').InferStepData<TDef> |
        Promise<void | Partial<import('../types').InferStepData<TDef>> | import('../types').InferStepData<TDef>>
    : never;
  beforeExit?: TDef extends { beforeExit: any }
    ? (args: import('../types').StepExitArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => void | Promise<void>
    : never;
  canEnter?: TDef extends { canEnter: any }
    ? (args: import('../types').StepEnterArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => boolean
    : never;
  canExit?: TDef extends { canExit: any }
    ? (args: import('../types').StepExitArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => boolean
    : never;
  complete?: TDef extends { complete: any }
    ? (args: import('../types').StepArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => boolean
    : never;
  next: TDef['next'];
  meta?: TDef['meta'];
  weight?: TDef extends { weight: any }
    ? (args: import('../types').StepArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => number
    : never;
  required?: TDef extends { required: any }
    ? (args: import('../types').StepArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => boolean
    : never;
  maxRetries?: TDef extends { maxRetries: any }
    ? (args: import('../types').StepArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => number
    : never;
  retryDelay?: TDef extends { retryDelay: any }
    ? (args: import('../types').StepArgs<unknown, S, import('../types').InferStepData<TDef>, never>) => number
    : never;
} : TDef;

// Step 3: Transform the entire steps object
type TransformStepDefs<T extends Record<string, StepDefInput>> = {
  [K in keyof T]: TransformStepDef<T[K], K & string, T>
};

// Test this approach
type TestSteps = {
  step1: {
    data: { name: string; count: number };
    beforeExit: (args: any) => void;
    next: ['step2'];
  };
  step2: {
    data: { success: boolean };
    next: [];
  };
};

type TransformedTestSteps = TransformStepDefs<TestSteps>;
type TransformedStep1 = TransformedTestSteps['step1'];
type TransformedBeforeExit = TransformedStep1['beforeExit'];

export type {
  StepDefInput,
  TransformStepDef,
  TransformStepDefs,
  TransformedTestSteps,
  TransformedStep1,
  TransformedBeforeExit,
};