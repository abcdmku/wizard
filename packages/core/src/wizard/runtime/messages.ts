/**
 * Human-readable messages for rejected commands and transitions. The machine records stable
 * reason tokens (`not-ready`, `flow-halted`, …); callers read a sentence that says what went
 * wrong and what to do instead. Codes stay the machine-readable part of every result.
 *
 * @internal
 */

import type { Command } from '../../machine/commands'
import type { TransitionRejectReason } from '../../machine/events'
import type { Issue } from '../../machine/state'

const RUN_STATE: Readonly<Record<string, string>> = {
  'flow-not-started': 'the run has not started yet; call start() first',
  'flow-terminal': 'the run has finished (done, failed or cancelled); nothing can change it now',
  'flow-halted':
    'the run is halted by a failed step; recover it first with retry(step), skip(step), run(step), compensate() or cancel()',
  'flow-compensating': 'the run is compensating; only cancel() and child commands are accepted',
}

/** The step a command names, if any (`child` commands name their flow step). */
export function commandStep(command: Command): string | undefined {
  if ('step' in command && typeof command.step === 'string') return command.step
  return command.type === 'child' ? command.path[0] : undefined
}

/** A `command.rejected` reason token → sentence. Unknown tokens are returned as they are. */
export function rejectionMessage(reason: string, command: Command): string {
  const known = RUN_STATE[reason]
  if (known !== undefined) return `${command.type}: ${known}`
  const step = `'${commandStep(command) ?? '?'}'`
  const [token, detail] = splitReason(reason)
  switch (token) {
    case 'unknown-step':
      return `${step} is not a step of this flow`
    case 'not-a-view':
      return `${step} is not a view; only views have input and can be navigated to`
    case 'not-runnable':
      return `${step} has no run function; only runnable steps can be run or retried`
    case 'not-a-flow-step':
      return `${step} is not a flow step`
    case 'child-not-running':
      return `the child flow of ${step} is not running`
    case 'empty-path':
      return 'a child command needs a non-empty path'
    case 'when-pending':
      return `${step} is waiting for its when() predicate`
    case 'not-ready':
      return `${step} is not ready: it has not been reached yet or its dependsOn steps are not done`
    case 'not-failed':
      return `${step} has not failed; retry(step) re-runs a failed step only`
    case 'completing-step':
      return `${step} completes the flow and cannot be skipped`
    case 'not-skippable':
      return `${step} is ${detail ?? 'not ready'}; only a ready or active step can be skipped`
    case 'nav-busy':
      return `${step} is busy: a navigation involving it is still in flight`
    case 'current-view':
      return `${step} is the current view; navigate away before invalidating it`
    case 'active':
      return `${step} is active; skip or cancel it before invalidating it`
    case 'not-invalidatable':
      return `${step} is ${detail ?? 'not settled'}; only done, failed or skipped steps can be invalidated`
    case 'not-a-failure':
      return `${step} has no failed compensation to re-run`
    case 'invalid-command':
      return command.type === 'start'
        ? 'start: the run has already started'
        : `${command.type}: not accepted in the current state`
    default:
      return reason
  }
}

function splitReason(reason: string): readonly [string, string | undefined] {
  const at = reason.indexOf(':')
  return at < 0 ? [reason, undefined] : [reason.slice(0, at), reason.slice(at + 1)]
}

/** A `transition.rejected` reason → sentence. */
export function navMessage(
  reason: TransitionRejectReason,
  step: string | undefined,
  issues: readonly Issue[] | undefined,
): string {
  const name = `'${step ?? '?'}'`
  switch (reason) {
    case 'nav-busy':
      return 'a navigation is still in flight (or the current view is entering or waiting for its event); try again once it settles'
    case 'not-a-view':
      return `${name} is not a view; only views can be navigated to`
    case 'not-active':
      return 'there is no current view to leave'
    case 'not-reachable':
      return `${name} is not reachable: it is the current view, or neither ready nor visited before`
    case 'validation':
      return `the input of ${name} is invalid: ${issueText(issues ?? [])}`
    case 'guard-canExit':
      return `canExit() of ${name} refused to leave it`
    case 'guard-canEnter':
      return `canEnter() of ${name} refused to enter it`
    case 'no-target':
      return `${name} has no next step to go to`
    case 'no-history':
      return 'there is no previous view to go back to'
    case 'resumed':
      return 'the navigation was interrupted by a restart; try again'
    case 'auto-advance-loop':
      return 'the navigation was stopped by the auto-advance loop guard'
    default:
      return RUN_STATE[reason] ?? reason
  }
}

function formatIssue(issue: Issue): string {
  const path = (issue.path ?? [])
    .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    .join('.')
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message
}

/** The first issue as `path: message`, with a count of the others. */
export function issueText(issues: readonly Issue[]): string {
  const first = issues[0]
  if (first === undefined) return 'no details'
  return issues.length > 1
    ? `${formatIssue(first)} (+${issues.length - 1} more)`
    : formatIssue(first)
}

/** Why an event reached nobody (`event.dropped.reason`) → sentence. */
export function droppedMessage(event: string, reason: string | undefined): string {
  switch (reason) {
    case 'correlation':
      return `'${event}' belongs to another run (its correlation id does not match this run's)`
    case 'no-listener':
      return `no step is waiting for '${event}' and unmatched events are not buffered`
    default:
      return `'${event}' was not routed to any step`
  }
}
