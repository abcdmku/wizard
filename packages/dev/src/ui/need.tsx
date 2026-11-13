import { type ReactElement, type ReactNode, useState } from 'react'
import type { Action, ActionResult } from '../wire'
import { useBackend } from './backend'
import { span } from './format'
import { Refusal } from './json'
import { Kind, MEANING, type OutsideKind } from './kind'

/** Sends one action and keeps what the run answered. */
export function useAction(
  run: string,
): [ActionResult | undefined, boolean, (action: Action) => void] {
  const backend = useBackend()
  const [result, setResult] = useState<ActionResult>()
  const [busy, setBusy] = useState(false)
  const send = (action: Action) => {
    setBusy(true)
    void backend
      .act(run, action)
      .then(setResult)
      .finally(() => setBusy(false))
  }
  return [result, busy, send]
}

/** One thing the run waits for: what it is, the controls that supply it and the code that would. */
export function Card(props: {
  readonly kind: OutsideKind
  readonly title: ReactNode
  readonly note?: string
  readonly code?: string
  readonly children: ReactNode
}): ReactElement {
  return (
    <article className="card need" data-kind={props.kind}>
      <div className="need-body">
        <header>
          <Kind kind={props.kind} />
          <h3>{props.title}</h3>
        </header>
        <p className="quiet note">{props.note ?? MEANING[props.kind]}</p>
        {props.children}
      </div>
      {props.code !== undefined && (
        <figure className="incode">
          <figcaption>In code</figcaption>
          <pre>
            <code>{props.code}</code>
          </pre>
        </figure>
      )}
    </article>
  )
}

/** `run` for the root run, `run.child('shipping')` for a step inside a child. */
export const scope = (path: readonly string[]): string =>
  path.reduce(
    (text, part) =>
      /^\d+$/.test(part) ? `${text.slice(0, -1)}, ${part})` : `${text}.child('${part}')`,
    'run',
  )

/** How a test moves time to a deadline `ms` away. */
export const advanceCode = (ms: number): string =>
  `// scheduler: createTestScheduler() from @openwizard/core/testing\nscheduler.advance(${Math.max(0, Math.round(ms))})`

/**
 * A deadline and, when it is the next timer of the run, the button that moves the run's clock
 * to it. Only the earliest timer can be skipped, so a later one says what comes first.
 */
export function Deadline(props: {
  readonly run: string
  readonly left: number
  readonly next: boolean
  readonly verb: string
  readonly effect: string
}): ReactElement {
  const [result, busy, send] = useAction(props.run)
  return (
    <div className="deadline">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 5v3l2 1.5" />
      </svg>
      <p>
        {props.verb} in <strong>{span(props.left)}</strong>.
        <span className="quiet">
          {props.next
            ? ` Skipping moves the run's clock ${span(props.left)} ahead, so ${props.effect}.`
            : ' An earlier timer fires first.'}
        </span>
      </p>
      {props.next && (
        <button type="button" disabled={busy} onClick={() => send({ type: 'skipTimer' })}>
          Skip to it
        </button>
      )}
      <Refusal result={result} />
    </div>
  )
}
