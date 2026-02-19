/**
 * @wizard/core - Step Wrapper System
 * Provides fluent API and proper type inference for wizard step operations
 */

import type { Wizard } from './types';

// ===== 1. Core Step Interface =====

/**
 * Represents a single step in the wizard with fluent API capabilities
 */
export interface WizardStep<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>,
  ErrorMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> {
  readonly name: StepName;
  readonly data: Readonly<Data> | undefined;
  readonly meta: import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined;
  readonly context: Readonly<Context>;
  readonly wizard: Wizard<Context, AllSteps, DataMap, never, ErrorMap>;
  readonly error: ErrorMap[StepName] | undefined;
  readonly status: import('./types').StepStatus;

  // Fluent step operations
  markIdle(): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  markLoading(): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  markSkipped(): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  markError(error: ErrorMap[StepName]): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  markTerminated(error?: ErrorMap[StepName]): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;

  // Data operations
  setData(data: Data): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  updateData(updater: Partial<Data>): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  updateData(updater: (data: Data | undefined) => Partial<Data>): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;

  // Meta operations
  setMeta(meta: import('./types').StepMetaCore<Context, AllSteps, Data, never>): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  updateMeta(updater: Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>> | ((meta: import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined) => Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>>)): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;

  // Navigation that returns step objects
  next(): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap, ErrorMap>>;
  goTo<Target extends AllSteps>(
    step: Target
  ): Promise<WizardStep<Target, DataMap[Target], Context, AllSteps, DataMap, ErrorMap>>;
  back(): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap, ErrorMap>>;

  // Utility methods
  canNavigateNext(): boolean;
  canNavigateTo(step: AllSteps): boolean;
  canNavigateBack(): boolean;
  clearError(): void;
}

// ===== 2. Step Wrapper Implementation =====

/**
 * Concrete implementation of WizardStep interface
 */
export class WizardStepImpl<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>,
  ErrorMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> implements WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {

  constructor(
    public readonly wizard: Wizard<Context, AllSteps, DataMap, never, ErrorMap>,
    public readonly name: StepName,
    public readonly data: Readonly<Data> | undefined,
    public readonly context: Readonly<Context>
  ) {
    // Bind updateData to preserve 'this' context when destructured
    this.updateData = this.updateData.bind(this);
  }

  // Computed properties
  get meta(): import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined {
    return this.wizard.getStepMeta(this.name as unknown as AllSteps) as import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined;
  }

  get error(): ErrorMap[StepName] | undefined {
    return this.wizard.getStepError(this.name as unknown as AllSteps) as
      | ErrorMap[StepName]
      | undefined;
  }

  get status(): import('./types').StepStatus {
    return this.wizard.helpers.stepStatus(this.name as unknown as AllSteps);
  }

  // ===== Fluent Step Operations =====

  markIdle = (): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.markIdle(this.name as unknown as AllSteps);
    return this.createFreshInstance();
  }

  markLoading = (): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.markLoading(this.name as unknown as AllSteps);
    return this.createFreshInstance();
  }

  markSkipped = (): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.markSkipped(this.name as unknown as AllSteps);
    return this.createFreshInstance();
  }

  markError = (
    error: ErrorMap[StepName]
  ): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.markError(this.name as unknown as AllSteps, error);
    return this.createFreshInstance();
  }

  markTerminated = (
    error?: ErrorMap[StepName]
  ): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.markTerminated(this.name as unknown as AllSteps, error);
    return this.createFreshInstance();
  }

  // ===== Data Operations =====

  setData = (data: Data): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.setStepData(this.name as unknown as AllSteps, data as DataMap[AllSteps]);
    return this.createFreshInstanceWithData(data);
  }

  updateData(updater: Partial<Data>): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  updateData(updater: (data: Data | undefined) => Partial<Data>): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap>;
  updateData(updater: Partial<Data> | ((data: Data | undefined) => Partial<Data>)): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
    // Use the wizard's atomic updateStepData method to avoid race conditions
    if (typeof updater === 'function') {
      // For function form, create a properly typed wrapper that preserves the Data type
      const typedUpdater = (current: DataMap[AllSteps] | undefined): Partial<DataMap[AllSteps]> => {
        // Cast current to Data | undefined to match the updater signature
        const result = updater(current as Data | undefined);
        return result as Partial<DataMap[AllSteps]>;
      };
      this.wizard.updateStepData(this.name as unknown as AllSteps, typedUpdater);
    } else {
      // For object form, pass directly
      this.wizard.updateStepData(this.name as unknown as AllSteps, updater as Partial<DataMap[AllSteps]>);
    }
    const newData = this.wizard.getStepData(this.name as unknown as AllSteps) as Data;
    return this.createFreshInstanceWithData(newData);
  }

  // ===== Meta Operations =====

  setMeta = (meta: import('./types').StepMetaCore<Context, AllSteps, Data, never>): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.setStepMeta(this.name as unknown as AllSteps, meta as any);
    return this.createFreshInstance();
  }

  updateMeta = (updater: Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>> | ((meta: import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined) => Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>>)): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> => {
    this.wizard.updateStepMeta(this.name as unknown as AllSteps, updater as any);
    return this.createFreshInstance();
  }

  // ===== Navigation Methods =====

  next = async (): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap, ErrorMap>> => {
    await this.wizard.next();
    const current = this.wizard.getCurrent();
    return new WizardStepImpl(
      this.wizard,
      current.step,
      current.data,
      current.context
    );
  }

  goTo = async <Target extends AllSteps>(
    step: Target
  ): Promise<WizardStep<Target, DataMap[Target], Context, AllSteps, DataMap, ErrorMap>> => {
    await this.wizard.goTo(step);
    const stepData = this.wizard.getStepData(step);
    return new WizardStepImpl(
      this.wizard,
      step,
      stepData,
      this.wizard.getContext()
    );
  }

  back = async (): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap, ErrorMap>> => {
    await this.wizard.back();
    const current = this.wizard.getCurrent();
    return new WizardStepImpl(
      this.wizard,
      current.step,
      current.data,
      current.context
    );
  }

  // ===== Utility Methods =====

  canNavigateNext = (): boolean => {
    return this.wizard.helpers.canGoNext();
  }

  canNavigateTo = (step: AllSteps): boolean => {
    return this.wizard.helpers.canGoTo(step);
  }

  canNavigateBack = (): boolean => {
    return this.wizard.helpers.canGoBack();
  }

  clearError = (): void => {
    this.wizard.clearStepError(this.name as unknown as AllSteps);
  }

  // ===== Private Helper Methods =====

  private createFreshInstance(): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
    const currentData = this.wizard.getStepData(this.name as unknown as AllSteps) as Data | undefined;
    return new WizardStepImpl(
      this.wizard,
      this.name,
      currentData,
      this.wizard.getContext()
    );
  }

  private createFreshInstanceWithData(data: Data): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
    return new WizardStepImpl(
      this.wizard,
      this.name,
      data,
      this.wizard.getContext()
    );
  }
}

// ===== 3. Factory Functions =====

/**
 * Creates a properly typed step wrapper
 */
export function createStepWrapper<
  StepName extends AllSteps,
  Data extends DataMap[StepName],
  Context,
  AllSteps extends string,
  DataMap extends Record<AllSteps, unknown>,
  ErrorMap extends Record<AllSteps, unknown>
>(
  wizard: Wizard<Context, AllSteps, DataMap, never, ErrorMap>,
  stepName: StepName,
  data: Data | undefined,
  context: Context
): WizardStep<StepName, Data, Context, AllSteps, DataMap, ErrorMap> {
  return new WizardStepImpl(wizard, stepName, data, context);
}

/**
 * Creates a step wrapper for the current step
 */
export function createCurrentStepWrapper<
  Context,
  AllSteps extends string,
  DataMap extends Record<AllSteps, unknown>,
  ErrorMap extends Record<AllSteps, unknown>
>(
  wizard: Wizard<Context, AllSteps, DataMap, never, ErrorMap>
): WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap, ErrorMap> {
  const current = wizard.getCurrent();
  return new WizardStepImpl(wizard, current.step, current.data as DataMap[AllSteps], current.context);
}
