import type { ReactElement } from 'react'

/** Everything outside a run that a step can depend on. Each has its own badge. */
export type OutsideKind = 'form' | 'webhook' | 'queue' | 'event' | 'service' | 'timer' | 'failed'

const LABEL: Readonly<Record<OutsideKind, string>> = {
  form: 'Form',
  webhook: 'Webhook',
  queue: 'Queue event',
  event: 'Event',
  service: 'Service call',
  timer: 'Timer',
  failed: 'Failed step',
}

/** What each kind means, in one line. */
export const MEANING: Readonly<Record<OutsideKind, string>> = {
  form: 'A person types this in.',
  webhook: 'Another system posts this to a signed webhook route.',
  queue: 'A consumer reads this from a queue and sends it to the run.',
  event: 'Your code sends this to the run.',
  service: 'The run calls out and waits for the reply.',
  timer: 'The run waits for a time.',
  failed: 'A step threw and the run stopped.',
}

const PATHS: Readonly<Record<OutsideKind, string>> = {
  // A pencil on a page.
  form: 'M3 13h10M4.5 10.5l.5-2.5 5.5-5.5 2 2L7 10z',
  // An arrow coming in through a door.
  webhook: 'M13 3v10M10 8H2.5M5.5 5 2.5 8l3 3',
  // Three messages in a line.
  queue: 'M2.5 4h11M2.5 8h11M2.5 12h11',
  // A bolt.
  event: 'M9 2 4 9h3.5L7 14l5-7H8.5z',
  // An arrow going out.
  service: 'M3 3v10M6 8h7.5M10.5 5l3 3-3 3',
  // A clock.
  timer: 'M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5',
  // A cross.
  failed: 'M4 4l8 8M12 4l-8 8',
}

/** The badge of one kind of outside dependency: an icon, a name and a colour of its own. */
export function Kind({ kind }: { readonly kind: OutsideKind }): ReactElement {
  return (
    <span className="kind" data-kind={kind} title={MEANING[kind]}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={PATHS[kind]} />
      </svg>
      {LABEL[kind]}
    </span>
  )
}
