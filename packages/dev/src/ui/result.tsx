import type { ReactElement, ReactNode } from 'react'
import type { RunDetail } from '../wire'
import { JsonView } from './json'

type Loose = {
  readonly kind?: string
  readonly step?: string
  readonly reason?: string
  readonly error?: { readonly message?: string; readonly name?: string } | string
  readonly compensation?: { readonly outcome?: string }
}

/** The message of a thrown value, whatever shape it was stored in. */
const messageOf = (error: Loose['error']): string | undefined =>
  typeof error === 'string' ? error : error?.message

const HEADLINE = { done: 'Done', failed: 'Failed', cancelled: 'Cancelled' } as const

/** One sentence on why the run ended as it did. */
function why(failure: Loose | undefined): ReactNode {
  if (failure === undefined) return null
  if (failure.kind === 'cancelled')
    return failure.reason === undefined
      ? 'The run was cancelled before it finished.'
      : `Reason: ${failure.reason}`
  const at =
    failure.step === undefined ? null : (
      <>
        {' '}
        at <code>{failure.step}</code>
      </>
    )
  if (failure.kind === 'compensation')
    return <>An undo hook failed{at}, so some work stayed done.</>
  return <>The run stopped{at}.</>
}

/** How a finished run ended: the outcome in words, the output or the failure, then everything. */
export function RunOutcome({ run }: { readonly run: RunDetail }): ReactElement | null {
  const result = run.result
  if (result === undefined) return null
  const failure = 'failure' in result ? (result.failure as Loose) : undefined
  const message = messageOf(failure?.error)
  const undo = failure?.compensation?.outcome
  return (
    <section className="card outcome" data-status={result.status} aria-labelledby="outcome-title">
      <header>
        <span className="outcome-mark">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d={
                result.status === 'done'
                  ? 'M3.5 8.5 6.5 11.5 12.5 4.5'
                  : result.status === 'failed'
                    ? 'M4.5 4.5l7 7M11.5 4.5l-7 7'
                    : 'M4 8h8'
              }
            />
          </svg>
        </span>
        <div>
          <h2 id="outcome-title">{HEADLINE[result.status]}</h2>
          <p className="quiet">
            {result.status === 'done' ? 'The run finished. This is its output.' : why(failure)}
          </p>
        </div>
      </header>
      {result.status === 'done' && <JsonView value={result.output} />}
      {message !== undefined && <p className="outcome-error">{message}</p>}
      {undo !== undefined && (
        <p className="quiet">
          Undo hooks ran. Outcome: <code>{undo}</code>.
        </p>
      )}
      <details>
        <summary>Full result</summary>
        <JsonView value={result} />
      </details>
    </section>
  )
}
