/**
 * The short status word a step card shows, and the tone that colours it. The word is what a
 * person reads; the tone picks the tint and border, so colour is never the only signal.
 *
 * @packageDocumentation
 */

import type { ManifestStep } from '@openwizard/core/inspect'
import type { StepStatusInfo } from '../types'

/** The colour family of a status word. */
export type StatusTone =
  | 'running'
  | 'waiting'
  | 'retrying'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'undoing'
  | 'undone'

/** What a step card shows for its live status, or `undefined` for an idle step. */
export interface StatusWord {
  readonly tone: StatusTone
  readonly text: string
  /** A longer account for the tooltip and screen readers. */
  readonly title: string
}

/** A step that waits on the outside world rather than running code. */
function waitsOutside(step: ManifestStep): boolean {
  return (
    step.kind === 'view' ||
    step.sleep !== undefined ||
    (step.waitsFor !== undefined && step.waitsFor.length > 0)
  )
}

function active(live: StepStatusInfo, step: ManifestStep): StatusWord {
  switch (live.phase) {
    case 'waiting':
      return { tone: 'waiting', text: 'waiting', title: waitingTitle(step) }
    case 'retrying':
      return { tone: 'retrying', text: 'retrying', title: 'Failed and waiting to run again' }
    case 'validating':
      return { tone: 'running', text: 'checking', title: 'Checking the submitted input' }
    case 'running':
    case 'entering':
    case 'exiting':
      return { tone: 'running', text: 'running', title: 'Running now' }
    default:
      return waitsOutside(step)
        ? { tone: 'waiting', text: 'waiting', title: waitingTitle(step) }
        : { tone: 'running', text: 'running', title: 'Running now' }
  }
}

function waitingTitle(step: ManifestStep): string {
  if (step.kind === 'view') return 'Waiting for a person to submit the form'
  if (step.sleep !== undefined) return 'Waiting for its timer'
  if (step.waitsFor !== undefined && step.waitsFor.length > 0)
    return `Waiting for ${step.waitsFor.join(' or ')}`
  return 'Waiting for its child run'
}

/** The status word for a step's live facts, or `undefined` when there is nothing to say. */
export function statusWord(
  live: StepStatusInfo | undefined,
  step: ManifestStep,
): StatusWord | undefined {
  if (live === undefined) return undefined
  switch (live.status) {
    case 'active':
      return active(live, step)
    case 'done':
      return { tone: 'done', text: 'done', title: 'Finished' }
    case 'failed':
      return { tone: 'failed', text: 'failed', title: 'Failed with no retries left' }
    case 'skipped':
      return { tone: 'skipped', text: 'skipped', title: 'Skipped: this path was not taken' }
    case 'cancelled':
      return { tone: 'cancelled', text: 'cancelled', title: 'Cancelled before it finished' }
    case 'compensating':
      return { tone: 'undoing', text: 'undoing', title: 'Running its undo hook' }
    case 'compensated':
      return { tone: 'undone', text: 'undone', title: 'Its undo hook has run' }
    default:
      return undefined
  }
}
