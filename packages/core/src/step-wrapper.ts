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
  StepName extends string,
  Data,
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> {
  readonly name: StepName;
  readonly data: Readonly<Data> | undefined;
  readonly meta: import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined;
  readonly context: Readonly<Context>;
  readonly wizard: Wizard<Context, AllSteps, DataMap, never>;
  readonly error: unknown;
  readonly status: import('./types').StepStatus;

  // Fluent step operations
  markIdle(): WizardStep<StepName, Data, Context, AllSteps, DataMap>;
  markLoading(): WizardStep<StepName, Data, Context, AllSteps, DataMap>;
  markSkipped(): WizardStep<StepName, Data, Context, AllSteps, DataMap>;
  markError(error: unknown): WizardStep<StepName, Data, Context, AllSteps, DataMap>;
  markTerminated(error?: unknown): WizardStep<StepName, Data, Context, AllSteps, DataMap>;

  // Data operations
  setData(data: Data): WizardStep<StepName, Data, Context, AllSteps, DataMap>;
  updateData(updater: Partial<Data> | ((data: Data | undefined) => Partial<Data>)): WizardStep<StepName, Data, Context, AllSteps, DataMap>;

  // Meta operations
  setMeta(meta: import('./types').StepMetaCore<Context, AllSteps, Data, never>): WizardStep<StepName, Data, Context, AllSteps, DataMap>;
  updateMeta(updater: Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>> | ((meta: import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined) => Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>>)): WizardStep<StepName, Data, Context, AllSteps, DataMap>;

  // Navigation that returns step objects
  next(): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>>;
  goTo<Target extends AllSteps>(
    step: Target
  ): Promise<WizardStep<Target, DataMap[Target], Context, AllSteps, DataMap>>;
  back(): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>>;

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
  StepName extends string,
  Data,
  Context,
  AllSteps extends string = string,
  DataMap extends Record<AllSteps, unknown> = Record<AllSteps, unknown>
> implements WizardStep<StepName, Data, Context, AllSteps, DataMap> {

  constructor(
    public readonly wizard: Wizard<Context, AllSteps, DataMap, never>,
    public readonly name: StepName,
    public readonly data: Readonly<Data> | undefined,
    public readonly context: Readonly<Context>
  ) {
    // Bind all methods to preserve 'this' context when destructured
    this.markIdle = this.markIdle.bind(this);
    this.markLoading = this.markLoading.bind(this);
    this.markSkipped = this.markSkipped.bind(this);
    this.markError = this.markError.bind(this);
    this.markTerminated = this.markTerminated.bind(this);
    this.setData = this.setData.bind(this);
    this.updateData = this.updateData.bind(this);
    this.setMeta = this.setMeta.bind(this);
    this.updateMeta = this.updateMeta.bind(this);
    this.next = this.next.bind(this);
    this.goTo = this.goTo.bind(this);
    this.back = this.back.bind(this);
    this.canNavigateNext = this.canNavigateNext.bind(this);
    this.canNavigateTo = this.canNavigateTo.bind(this);
    this.canNavigateBack = this.canNavigateBack.bind(this);
    this.clearError = this.clearError.bind(this);
  }

  // Computed properties
  get meta(): import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined {
    return this.wizard.getStepMeta(this.name as unknown as AllSteps) as import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined;
  }

  get error(): unknown {
    return this.wizard.getStepError(this.name as unknown as AllSteps);
  }

  get status(): import('./types').StepStatus {
    return this.wizard.helpers.stepStatus(this.name as unknown as AllSteps);
  }

  // ===== Fluent Step Operations =====

  markIdle(): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.markIdle(this.name as unknown as AllSteps);
    return this.createFreshInstance();
  }

  markLoading(): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.markLoading(this.name as unknown as AllSteps);
    return this.createFreshInstance();
  }

  markSkipped(): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.markSkipped(this.name as unknown as AllSteps);
    return this.createFreshInstance();
  }

  markError(error: unknown): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.markError(this.name as unknown as AllSteps, error);
    return this.createFreshInstance();
  }

  markTerminated(error?: unknown): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.markTerminated(this.name as unknown as AllSteps, error);
    return this.createFreshInstance();
  }

  // ===== Data Operations =====

  setData(data: Data): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.setStepData(this.name as unknown as AllSteps, data as DataMap[AllSteps]);
    return this.createFreshInstanceWithData(data);
  }

  updateData(updater: Partial<Data> | ((data: Data | undefined) => Partial<Data>)): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    // Use the wizard's atomic updateStepData method to avoid race conditions
    this.wizard.updateStepData(this.name as unknown as AllSteps, updater as any);
    const newData = this.wizard.getStepData(this.name as unknown as AllSteps) as Data;
    return this.createFreshInstanceWithData(newData);
  }

  // ===== Meta Operations =====

  setMeta(meta: import('./types').StepMetaCore<Context, AllSteps, Data, never>): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.setStepMeta(this.name as unknown as AllSteps, meta as any);
    return this.createFreshInstance();
  }

  updateMeta(updater: Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>> | ((meta: import('./types').StepMetaCore<Context, AllSteps, Data, never> | undefined) => Partial<import('./types').StepMetaCore<Context, AllSteps, Data, never>>)): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    this.wizard.updateStepMeta(this.name as unknown as AllSteps, updater as any);
    return this.createFreshInstance();
  }

  // ===== Navigation Methods =====

  async next(): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>> {
    await this.wizard.next();
    const current = this.wizard.getCurrent();
    return new WizardStepImpl(
      this.wizard,
      current.step,
      current.data,
      current.context
    );
  }

  async goTo<Target extends AllSteps>(
    step: Target
  ): Promise<WizardStep<Target, DataMap[Target], Context, AllSteps, DataMap>> {
    await this.wizard.goTo(step);
    const stepData = this.wizard.getStepData(step);
    return new WizardStepImpl(
      this.wizard,
      step,
      stepData,
      this.wizard.getContext()
    );
  }

  async back(): Promise<WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap>> {
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

  canNavigateNext(): boolean {
    return this.wizard.helpers.canGoNext();
  }

  canNavigateTo(step: AllSteps): boolean {
    return this.wizard.helpers.canGoTo(step);
  }

  canNavigateBack(): boolean {
    return this.wizard.helpers.canGoBack();
  }

  clearError(): void {
    this.wizard.clearStepError(this.name as unknown as AllSteps);
  }

  // ===== Private Helper Methods =====

  private createFreshInstance(): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
    const currentData = this.wizard.getStepData(this.name as unknown as AllSteps) as Data | undefined;
    return new WizardStepImpl(
      this.wizard,
      this.name,
      currentData,
      this.wizard.getContext()
    );
  }

  private createFreshInstanceWithData(data: Data): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
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
  StepName extends string,
  Data,
  Context,
  AllSteps extends string,
  DataMap extends Record<AllSteps, unknown>
>(
  wizard: Wizard<Context, AllSteps, DataMap, never>,
  stepName: StepName,
  data: Data | undefined,
  context: Context
): WizardStep<StepName, Data, Context, AllSteps, DataMap> {
  return new WizardStepImpl(wizard, stepName, data, context);
}

/**
 * Creates a step wrapper for the current step
 */
export function createCurrentStepWrapper<
  Context,
  AllSteps extends string,
  DataMap extends Record<AllSteps, unknown>
>(
  wizard: Wizard<Context, AllSteps, DataMap, never>
): WizardStep<AllSteps, DataMap[AllSteps], Context, AllSteps, DataMap> {
  const current = wizard.getCurrent();
  return new WizardStepImpl(wizard, current.step, current.data as DataMap[AllSteps], current.context);
}