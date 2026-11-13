/**
 * The words the run page uses for a status. The engine's names (`compensating`, `active`,
 * `halted`) are precise but some read wrong to a person, so every pill, card and panel takes its
 * word from here and the run page never shows two words for one state.
 *
 * The vocabulary: `running`, `waiting on you`, `waiting`, `retrying`, `failed`, `halted`,
 * `undoing`, `undone`, `done`, `skipped`, `cancelled`, `not run`, `blocked`. Each word has one
 * colour, set by `data-status` in the styles: running is `--info`; waiting on you, waiting and
 * retrying `--warn`; failed and halted `--bad`; done `--good`; undoing and undone `--undo`;
 * skipped, cancelled, not run and blocked `--quiet`.
 */

import type { RunDetail } from '../wire'

/**
 * The word for a run. `status` is the engine's run status and `waiting` the number of things
 * a person must supply (`RunSummary.waiting`). A live run with anything to supply reads
 * `waiting on you`. Otherwise one with a step waiting out a retry delay (`retrying`, from
 * `RunSummary.retrying`) reads `retrying`, and one that waits only on a timer reads `waiting`.
 */
export function runWord(status: string, waiting: number, retrying = false): string {
  switch (status) {
    case 'done':
    case 'failed':
    case 'cancelled':
    case 'halted':
      return status
    case 'compensating':
      return 'undoing'
    case 'compensated':
      return 'undone'
  }
  if (waiting > 0) return 'waiting on you'
  if (retrying) return 'retrying'
  return status === 'waiting' ? 'waiting' : 'running'
}

/** What the run page knows about a step besides its status and phase. */
export interface StepFacts {
  /** The step waits on something a person here supplies: a form, an event or a service call. */
  readonly person?: boolean
  /** The run has ended: done, failed or cancelled. */
  readonly ended?: boolean
  /**
   * The step can no longer start though the run goes on: the run is undoing, failed or halted,
   * or the step is only the timeout or fallback target of a step that finished. See `notRunWhy`.
   */
  readonly closed?: boolean
  /** The step waits on the outside by design: a form, a sleep or an event wait. */
  readonly outside?: boolean
}

/**
 * The word for a step, the same word the graph shows on its card. `status` is its stored status
 * (`idle`, `active`, `done` and so on) and `phase` its live phase from `run.explain(step).phase`,
 * which the server reports for steps of the root run only.
 *
 * - A step that finished, failed or is being undone keeps its own word, even when its undo
 *   hook made the call a person answers.
 * - An idle step reads `blocked` while it can still start and `not run` once the run has ended
 *   or the step can no longer start (`closed`), as the graph says.
 * - A step a person must act on reads `waiting on you`, as the graph's attention ring says.
 */
export function stepWord(
  status: string | undefined,
  phase?: string,
  facts: StepFacts = {},
): string {
  switch (status) {
    case 'done':
    case 'failed':
    case 'skipped':
    case 'cancelled':
      return status
    case 'compensating':
      return 'undoing'
    case 'compensated':
      return 'undone'
    case undefined:
    case 'idle':
      if (facts.ended === true || facts.closed === true) return 'not run'
      return facts.person === true ? 'waiting on you' : 'blocked'
  }
  if (phase === 'compensating') return 'undoing'
  if (facts.person === true) return 'waiting on you'
  switch (phase) {
    case 'retrying':
      return 'retrying'
    case 'waiting':
      return 'waiting'
    case undefined:
      return facts.outside === true ? 'waiting' : 'running'
    default:
      return 'running'
  }
}

/** The `data-status` value for a word, which picks the pill's colour. One per word, no spaces. */
export function wordTone(word: string): string {
  return word.replaceAll(' ', '-')
}

/** The run statuses after which nothing waits on a person. */
const OVER = new Set(['done', 'failed', 'cancelled', 'compensated'])

/**
 * The keys of the steps that wait on a person: every step a form or an event card names
 * (`shipping/street` inside a child) and the step a service call card names. A call the server
 * could not place marks every root step whose phase is `running`, since in this UI a running
 * step is one blocked on a call you answer. A call from an undo hook marks nothing: that step
 * reads `undoing`. A run that has ended waits on no one, even when a call it made is still open.
 */
export function attentionOf(run: RunDetail): readonly string[] {
  if (OVER.has(run.status)) return []
  const keys = new Set<string>()
  let unplaced = false
  for (const item of run.pending) {
    if (item.kind === 'view' || item.kind === 'event') keys.add([...item.path, item.step].join('/'))
    else if (item.kind === 'call') {
      if (item.step === undefined) unplaced = true
      else if (item.undo !== true) keys.add([...(item.path ?? []), item.step].join('/'))
    }
  }
  if (unplaced)
    for (const [key, phase] of Object.entries(run.phases)) if (phase === 'running') keys.add(key)
  return [...keys]
}
