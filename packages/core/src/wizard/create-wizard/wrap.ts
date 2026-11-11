/**
 * The single untyped → typed boundary: the cached `Run<F>` façade around an untyped
 * `WizardRuntime`, and the typed view of a runtime outcome.
 */
import type { CompiledWizard } from '../../authoring/compiled'
import type { AnyWizardDefinition, ChildWizardOf } from '../../authoring/types'
import { WizardError } from '../../errors'
import type { DomainEvent } from '../../machine/events'
import { applyProjection } from '../../projection/apply-projection'
import { sameDefinition } from '../definition-identity'
import type { RunOutcome } from '../results'
import type { WizardRuntime } from '../runtime'
import type { RuntimeOutcome } from '../runtime/outcome'
import type { RunEvent } from './state'
import type { Run } from './wizard'

/** A runtime outcome of a run of wizard `F`, typed by `F`. */
export function typedOutcome<F extends AnyWizardDefinition>(
  outcome: RuntimeOutcome,
): RunOutcome<F> {
  return outcome as unknown as RunOutcome<F>
}

const wrappers = new WeakMap<WizardRuntime, Run<AnyWizardDefinition>>()

export function wrap<F extends AnyWizardDefinition>(
  runtime: WizardRuntime,
  wizard: F,
  def: CompiledWizard,
): Run<F> {
  const existing = wrappers.get(runtime)
  if (existing !== undefined) return existing as unknown as Run<F>
  const {
    path: _path,
    epoch: _epoch,
    child: _child,
    isDisposed: _isDisposed,
    outcome: _outcome,
    resumeFrom: _resumeFrom,
    prepareResume: _prepareResume,
    resumePrepared: _resumePrepared,
    ...forward
  } = runtime as WizardRuntime & {
    readonly resumeFrom?: unknown
    readonly prepareResume?: unknown
    readonly resumePrepared?: unknown
  }
  // Events carry the absolute path from the root run; a child run reports them relative to itself
  // (its own events `path: []`), as `RunEvent<F>` and `waitingFor()` describe them.
  const depth = runtime.path.length
  const relative = (event: DomainEvent): RunEvent<F> =>
    (depth === 0 ? event : { ...event, path: event.path.slice(depth) }) as RunEvent<F>
  const run: Run<F> = {
    ...(forward as unknown as Omit<
      Run<F>,
      'epoch' | 'wizard' | 'child' | 'project' | 'observe' | 'log'
    >),
    get epoch() {
      return runtime.epoch
    },
    wizard,
    observe: (listener) => runtime.observe((event) => listener(relative(event))),
    log: () => runtime.log().map(relative),
    child: (step, ...[keyOrIndex]) => {
      const childRuntime = runtime.child(step, keyOrIndex)
      const childDef = def.steps[step]?.child
      const childWizard = (
        wizard.steps as Record<string, { readonly child?: AnyWizardDefinition }>
      )[step]?.child
      if (childDef === undefined || childWizard === undefined) {
        throw new WizardError('NOT_A_CHILD_STEP', `'${step}' is not a child step`, { step })
      }
      return wrap(childRuntime, childWizard, childDef) as unknown as Run<
        ChildWizardOf<F, typeof step>
      >
    },
    project: (projection, ...scope) => {
      if (!sameDefinition(projection.wizard, wizard)) {
        throw new WizardError(
          'DEFINITION_INVALID',
          `projection was defined for wizard '${projection.wizard.name}' (a different authored definition), not for this run's wizard '${def.name}'`,
        )
      }
      return applyProjection(
        projection,
        runtime.getState(),
        def,
        runtime.getSnapshot().children,
        ...scope,
      )
    },
  }
  wrappers.set(runtime, run as unknown as Run<AnyWizardDefinition>)
  return run
}
