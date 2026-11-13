/**
 * The short status word a step card shows, and the tone that colours it. The word is what a
 * person reads; the tone picks the tint and border, so colour is never the only signal.
 *
 * The words are a fixed set: `running`, `waiting on you`, `waiting`, `retrying`, `failed`,
 * `undoing`, `undone`, `done`, `skipped`, `cancelled`, `blocked` and `not run`.
 *
 * An idle step is `blocked` while it can still start and `not run` once it cannot: the run ended
 * or is undoing, or no way leads to it any more (`closedSteps`).
 *
 * What a step is doing comes first. A step that is undoing says `undoing` even when a person has
 * to answer it; the card then shows that with its attention ring, not with its word.
 *
 * @packageDocumentation
 */

import type { ManifestStep } from '@openwizard/core/inspect'
import type { StepStatusInfo } from '../types'
import type { NotRunReason } from './to-react-flow'

/** The colour family of a status word. */
export type StatusTone =
  | 'running'
  | 'attention'
  | 'waiting'
  | 'retrying'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'undoing'
  | 'undone'
  | 'blocked'
  | 'not-run'

/** What a step card shows for its live status, or `undefined` for an idle step. */
export interface StatusWord {
  readonly tone: StatusTone
  readonly text: string
  /** A longer account for the tooltip and screen readers. */
  readonly title: string
  /** `attempt 2 of 3` while a step with retries is retrying or after it failed. */
  readonly attempt?: string
}

/**
 * Whether a person has to act on a step: `true` or `false` when the host says so (the
 * `attention` prop), `undefined` when it does not, so a form waiting for input counts.
 */
export type Attention = boolean | undefined

const ON_YOU: StatusWord = {
  tone: 'attention',
  text: 'waiting on you',
  title: 'Waiting for you to act',
}

/** A step that waits on the outside world rather than running code. */
function waitsOutside(step: ManifestStep): boolean {
  return (
    step.kind === 'view' ||
    step.sleep !== undefined ||
    (step.waitsFor !== undefined && step.waitsFor.length > 0)
  )
}

function waiting(step: ManifestStep, attention: Attention): StatusWord {
  if (attention === undefined && step.kind === 'view')
    return { ...ON_YOU, title: 'Waiting for a person to submit the form' }
  return { tone: 'waiting', text: 'waiting', title: waitingTitle(step) }
}

function waitingTitle(step: ManifestStep): string {
  if (step.kind === 'view') return 'Waiting for the form to be submitted'
  if (step.sleep !== undefined) return 'Waiting for its timer'
  if (step.waitsFor !== undefined && step.waitsFor.length > 0)
    return `Waiting for ${step.waitsFor.join(' or ')}`
  return 'Waiting for its child run'
}

/**
 * `attempt 2 of 3` when the step retries and the snapshot holds the attempt. While a step waits
 * to retry, its counter still holds the attempt that failed, so the word names the next one.
 */
function attemptOf(live: StepStatusInfo, step: ManifestStep, next = false): string | undefined {
  const retries = step.retry?.retries ?? 0
  if (live.attempt === undefined || retries < 1) return undefined
  return `attempt ${Math.min(live.attempt + (next ? 1 : 0), retries + 1)} of ${retries + 1}`
}

function active(live: StepStatusInfo, step: ManifestStep, attention: Attention): StatusWord {
  switch (live.phase) {
    case 'waiting':
      return waiting(step, attention)
    case 'retrying': {
      const attempt = attemptOf(live, step, true)
      return {
        tone: 'retrying',
        text: 'retrying',
        title: 'Failed and waiting to run again',
        ...(attempt === undefined ? {} : { attempt }),
      }
    }
    case 'validating':
    case 'running':
    case 'entering':
    case 'exiting':
      return { tone: 'running', text: 'running', title: 'Running now' }
    default:
      return waitsOutside(step)
        ? waiting(step, attention)
        : { tone: 'running', text: 'running', title: 'Running now' }
  }
}

const BLOCKED: StatusWord = {
  tone: 'blocked',
  text: 'blocked',
  title: 'Not started: it waits for the steps before it or the steps it needs',
}
const NOT_RUN_TITLE: Readonly<Record<NotRunReason, string>> = {
  ended: 'The run ended before this step started',
  undoing: 'The run is undoing its steps, so this one will not start',
  closed: 'It will not start: the steps that lead to it went another way',
}

function notRun(reason: NotRunReason): StatusWord {
  return { tone: 'not-run', text: 'not run', title: NOT_RUN_TITLE[reason] }
}

/** Statuses that say what a step is doing or did, which a person's turn does not replace. */
const OWN_WORD = new Set(['done', 'failed', 'skipped', 'cancelled', 'compensating', 'compensated'])

/**
 * The status word for a step's live facts, or `undefined` when there is nothing to say.
 * `attention` true makes a live or idle step `waiting on you`; a step that finished, failed or
 * is undoing keeps its own word. An idle step says `blocked` while it can still start, and `not
 * run` once it cannot (`notRun`: the run ended or is undoing, or no way leads to it any more).
 */
export function statusWord(
  live: StepStatusInfo | undefined,
  step: ManifestStep,
  attention?: Attention,
  notRunReason?: NotRunReason | boolean,
): StatusWord | undefined {
  if (attention === true && (live === undefined || !OWN_WORD.has(live.status))) return ON_YOU
  if (live === undefined) return undefined
  switch (live.status) {
    case 'active':
      return active(live, step, attention)
    case 'done':
      return { tone: 'done', text: 'done', title: 'Finished' }
    case 'failed': {
      const attempt = attemptOf(live, step)
      return {
        tone: 'failed',
        text: 'failed',
        title: 'Failed with no retries left',
        ...(attempt === undefined ? {} : { attempt }),
      }
    }
    case 'skipped':
      return { tone: 'skipped', text: 'skipped', title: 'Skipped: this path was not taken' }
    case 'cancelled':
      return { tone: 'cancelled', text: 'cancelled', title: 'Cancelled before it finished' }
    case 'compensating':
      return { tone: 'undoing', text: 'undoing', title: 'Running its undo hook' }
    case 'compensated':
      return { tone: 'undone', text: 'undone', title: 'Its undo hook has run' }
    case 'idle':
      if (notRunReason === undefined || notRunReason === false) return BLOCKED
      return notRun(notRunReason === true ? 'ended' : notRunReason)
    default:
      return undefined
  }
}
