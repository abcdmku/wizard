/**
 * The words the run page uses for a status. The engine's names (`compensating`, `active`,
 * `halted`) are precise but some read wrong to a person, so every pill, card and panel takes its
 * word from here and the run page never shows two words for one state.
 *
 * The vocabulary: `running`, `waiting on you`, `waiting`, `retrying`, `failed`, `halted`,
 * `undoing`, `undone`, `done`, `skipped`, `cancelled`, `blocked`.
 */

import type { RunDetail } from '../wire'

/**
 * The word for a run. `status` is the engine's run status and `waiting` the number of things
 * a person must supply (`RunSummary.waiting`). A live run with anything to supply reads
 * `waiting on you`; one that waits only on a timer reads `waiting`.
 */
export function runWord(status: string, waiting: number): string {
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
    case 'waiting':
      return waiting > 0 ? 'waiting on you' : 'waiting'
    default:
      return waiting > 0 ? 'waiting on you' : 'running'
  }
}

/**
 * The word for a step. `status` is its stored status (`idle`, `active`, `done` and so on) and
 * `phase` its live phase from `run.explain(step).phase`, when it has one. `person` is true when
 * the step waits on something a person here supplies: a form, an event or a service call.
 */
export function stepWord(status: string | undefined, phase?: string, person = false): string {
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
  }
  switch (phase) {
    case 'retrying':
      return 'retrying'
    case 'compensating':
      return 'undoing'
    case 'blocked':
    case 'ready':
      return 'blocked'
    case 'waiting':
      return person ? 'waiting on you' : 'waiting'
    case undefined:
      return status === 'active' ? (person ? 'waiting on you' : 'running') : 'blocked'
    default:
      return person ? 'waiting on you' : 'running'
  }
}

/** The `data-status` value for a word, which picks the pill's colour. One per word, no spaces. */
export function wordTone(word: string): string {
  return word.replaceAll(' ', '-')
}

/**
 * The keys of the steps that wait on a person: every step a form or an event card names
 * (`shipping/street` inside a child), the step a service call card names, and, when a service
 * call is pending, every root step whose phase is `running`, since in this UI a running step is
 * one blocked on a call you answer.
 */
export function attentionOf(run: RunDetail): readonly string[] {
  const keys = new Set<string>()
  let calls = false
  for (const item of run.pending) {
    if (item.kind === 'view' || item.kind === 'event') keys.add([...item.path, item.step].join('/'))
    else if (item.kind === 'call') {
      calls = true
      if (item.step !== undefined) keys.add([...(item.path ?? []), item.step].join('/'))
    }
  }
  if (calls)
    for (const [key, phase] of Object.entries(run.phases)) if (phase === 'running') keys.add(key)
  return [...keys]
}
