/** A wizard is its definition with run constructors bound to the same object. */
import { buildWizard } from '../authoring/build-wizard'
import type {
  AnyWizardDefinition,
  OutputIn,
  RoleIn,
  StepApi,
  Steps,
  UncheckedSteps,
  Wizard,
  WizardHeader,
} from '../authoring/types'
import type { ResumeOptions, RunOptions } from './create-wizard'
import {
  createRun,
  createRunAsync,
  resumeRun,
  resumeRunAsync,
  runToOutcome,
  runToOutcomeSync,
} from './create-wizard'
import { inheritDefinition } from './definition-identity'

/**
 * A wizard's output: the type of its `output` selector, else the union of its sink steps'
 * outputs, plus `undefined` when it has no sink.
 */
type OutputFor<O, M> = [O] extends [never]
  ?
      | { [K in keyof M]: RoleIn<M[K]> extends 'inner' ? never : OutputIn<M[K]> }[keyof M]
      | ('sink' extends { [K in keyof M]: RoleIn<M[K]> }[keyof M] ? never : undefined)
  : O

/**
 * Define a wizard. Return `steps(map, { start? })` from the callback.
 * Context, dependencies, events, step references and sink outputs are inferred.
 * @public
 */
export function defineWizard<
  C,
  CIn,
  Ev = {},
  D = unknown,
  O = never,
  M = UncheckedSteps,
  EvIn = Ev,
>(
  options: WizardHeader<C, CIn, Ev, D, O, EvIn>,
  build: (api: StepApi<C, Ev, D>) => Steps<M>,
): Wizard<C, CIn, Ev, D, M, OutputFor<O, M>, never, EvIn> {
  return bind(buildWizard(options, build)) as Wizard<C, CIn, Ev, D, M, OutputFor<O, M>, never, EvIn>
}

function bind(definition: AnyWizardDefinition, source?: AnyWizardDefinition): AnyWizardDefinition {
  if (source !== undefined) inheritDefinition(definition, source)
  const wizard: AnyWizardDefinition = Object.assign(definition, {
    create: (context: unknown, options: object = {}) =>
      createRun(wizard, inputOptions(context, options) as RunOptions<AnyWizardDefinition>),
    createAsync: (context: unknown, options: object = {}) =>
      createRunAsync(wizard, inputOptions(context, options) as RunOptions<AnyWizardDefinition>),
    resume: (snapshot: unknown, options: object = {}) =>
      resumeRun(wizard, snapshot, options as ResumeOptions<AnyWizardDefinition>),
    resumeAsync: (snapshot: unknown, options: object = {}) =>
      resumeRunAsync(wizard, snapshot, options as ResumeOptions<AnyWizardDefinition>),
    run: (context: unknown, options: object = {}) =>
      runToOutcome(wizard, inputOptions(context, options) as RunOptions<AnyWizardDefinition>),
    runSync: (context: unknown, options: object = {}) =>
      runToOutcomeSync(wizard, inputOptions(context, options) as RunOptions<AnyWizardDefinition>),
    provide: (deps: object) =>
      bind(
        {
          ...wizard,
          providedDeps: { ...wizard.providedDeps, ...deps },
        },
        wizard,
      ),
  })
  return wizard
}

/** Preserve dependency presence, including inherited getters, when adding the context input. */
function inputOptions(context: unknown, options: object): object {
  const input = { ...options, context }
  return !Object.hasOwn(input, 'deps') && 'deps' in options
    ? { ...input, deps: options.deps }
    : input
}
