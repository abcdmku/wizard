/** The exchanges the production pages draw. Each one restates what its page says in prose. */

/** A message from one participant to another. `reply` draws it dashed. */
export interface Message {
  readonly from: number
  readonly to: number
  readonly text: string
  readonly reply?: true
}

/** Something one participant does by itself. */
export interface Note {
  readonly at: number
  readonly text: string
  readonly tone?: 'bad' | 'good'
}

export interface SequenceData {
  /** What the diagram shows, read by screen readers and shown as its caption. */
  readonly caption: string
  readonly actors: readonly string[]
  readonly rows: readonly (Message | Note)[]
}

export const sequences: Readonly<Record<string, SequenceData>> = {
  lease: {
    caption: 'Two processes and one run. Only the process that holds the lease works on it.',
    actors: ['Process A', 'Durable store', 'Process B'],
    rows: [
      { from: 0, to: 1, text: 'host.create(key, input) takes the lease' },
      { at: 0, text: 'runs steps, renews the lease' },
      { from: 2, to: 1, text: 'host.dispatch(key, command)' },
      { from: 1, to: 2, text: 'LEASE_BUSY, try again at retryAt', reply: true },
      { at: 0, text: 'the process dies', tone: 'bad' },
      { at: 1, text: 'the lease expires after 30 seconds' },
      { from: 2, to: 1, text: 'takes the lease, loads the snapshot' },
      { at: 2, text: 'the interrupted step runs again, same idempotency key', tone: 'good' },
    ],
  },
  projection: {
    caption: 'The browser holds a copy of the fields a projection lists, and sends commands back.',
    actors: ['Browser mirror', 'Mirror source', 'Run'],
    rows: [
      { from: 2, to: 1, text: 'the state changes' },
      { from: 1, to: 0, text: 'a frame with the projected fields only' },
      { at: 0, text: 'React renders the mirror' },
      { from: 0, to: 1, text: 'mirror.next()' },
      { at: 1, text: 'checks the command against the wizard, then authorize' },
      { from: 1, to: 2, text: 'run.next()' },
      { from: 2, to: 1, text: 'the state changes' },
      { from: 1, to: 0, text: 'the next frame', reply: true },
    ],
  },
  webhook: {
    caption: 'A signed delivery reaches a waiting step once, however often the sender repeats it.',
    actors: ['Sender', 'Webhook route', 'Run'],
    rows: [
      { from: 0, to: 1, text: 'POST /webhooks/approval/approved, signed' },
      { at: 1, text: 'verifies the signature, then resolve picks the run' },
      { from: 1, to: 2, text: 'run.send(event, data, { eventId: webhook-id })' },
      { at: 2, text: 'parses data with the event schema, the wait ends', tone: 'good' },
      { from: 1, to: 0, text: 'the response', reply: true },
      { from: 0, to: 1, text: 'the same delivery again' },
      { from: 1, to: 0, text: 'the stored response, the run is not touched', reply: true },
    ],
  },
}
