/**
 * @openwizard/react — the public surface. `bindReact<typeof wizardOrProjection>()` returns a
 * typed `Provider` and hooks over a `Run` (wizard) or a `Mirror` (projection); `useRun` owns
 * that source inside a component.
 *
 * @packageDocumentation
 */

export { bindReact } from './bind-react'
export type {
  BindingOf,
  ChildBinding,
  ChildBindingId,
  ChildStateOf,
  ChildStepHelpers,
  Connection,
  ExposedChildId,
  MirrorBinding,
  ProviderProps,
  ReactBinding,
} from './binding-types'
export type {
  Actions,
  ActionsOf,
  BindTarget,
  CommandResultOf,
  CurrentOf,
  FieldOf,
  NavResultOf,
  RunActions,
  SendResultOf,
  SourceOf,
  StateOf,
  StepHelpers,
  StepRecordIn,
  StepRecordOf,
  UseStepResult,
  WizardOf,
} from './types'
export { useRun } from './use-run'
