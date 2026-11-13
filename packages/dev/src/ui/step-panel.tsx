import type { SnapshotLike } from '@openwizard/devtools'
import { type ReactElement, type ReactNode, useEffect, useRef } from 'react'
import type { RunDetail, WizardInfo } from '../wire'
import { Status } from './app'
import { ago, clock, duration, span } from './format'
import { JsonView } from './json'
import { attentionOf, stepWord } from './status-word'
import {
  choiceOf,
  kindOf,
  type ManifestNode,
  nodeOf,
  reasonText,
  recordOf,
  type StepRecordView,
  splitKey,
} from './step-facts'

const LIVE = new Set(['done', 'failed', 'cancelled'])

const SKIPPED: Readonly<Record<string, string>> = {
  when: 'its when check returned false',
  command: 'someone skipped it by hand',
  'not-taken': 'the route chose another step',
  'needs-skipped': 'a step it needs was skipped',
  fallback: 'it failed and its fallback took over',
  timeout: 'its wait timed out',
}

/** True when two stored values hold the same JSON. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** `the route chose another step` as `The route chose another step.` */
const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`

/** A time on the run's clock: how long ago, with the exact time on hover. */
function When({ at, now }: { readonly at: number; readonly now: number }): ReactElement {
  return (
    <time dateTime={new Date(at).toISOString()} title={clock(at)}>
      {ago(now - at)}
    </time>
  )
}

/**
 * The unmet needs as the step declares them: a need with `any` is one choice between its
 * steps, so `managerApproval or policyApproval` reads as one thing to wait for.
 */
function unitsOf(deps: readonly string[], node: ManifestNode | undefined): string[][] {
  const left = new Set(deps)
  const units: string[][] = []
  for (const need of Object.values(node?.needs ?? {})) {
    const open = need.steps.filter((step) => left.has(step))
    if (open.length === 0) continue
    if (need.kind === 'any') units.push(open)
    else for (const step of open) units.push([step])
    for (const step of open) left.delete(step)
  }
  for (const step of left) units.push([step])
  return units
}

/** What the step waits for or what holds it, in a sentence, or nothing. */
function holdOf(run: RunDetail, key: string, word: string, node?: ManifestNode): ReactNode {
  const { path, id } = splitKey(key)
  const here = (item: { readonly path: readonly string[]; readonly step: string }) =>
    item.step === id && item.path.join('/') === path.join('/')
  for (const item of run.pending) {
    if (item.kind === 'view' && here(item))
      return 'A person to fill in its form under Waiting for you.'
    if (item.kind === 'event' && here(item))
      return `The event ${item.events.map((event) => event.name).join(' or ')}.`
    if (item.kind === 'sleep' && here(item))
      return `Its sleep to end, in ${span(item.deadline - run.now)}.`
  }
  const timer = run.timer
  if (word === 'retrying' && timer?.purpose === 'retry' && timer.step === id)
    return `Its retry delay. It tries again in ${span(timer.at - run.now)}.`
  if (word === 'waiting on you' || word === 'running' || word === 'undoing') {
    const calls = run.pending.filter((item) => item.kind === 'call')
    const own = calls.filter(
      (call) =>
        call.step === undefined ||
        (call.step === id && (call.path ?? []).join('/') === path.join('/')),
    )
    if (own.length > 0)
      return (
        <>
          A reply to{' '}
          {own.map((call, index) => (
            <span key={call.id}>
              {index === 0 ? '' : ' and '}
              <code>{call.name}</code>
            </span>
          ))}{' '}
          under Waiting for you.
        </>
      )
  }
  if (word === 'blocked') {
    const reasons = run.reasons[key] ?? []
    const deps = reasons
      .filter((reason) => reason.startsWith('deps-unmet:'))
      .map((r) => r.slice(11))
    const other = reasons.filter(
      (reason) =>
        !reason.startsWith('deps-unmet:') &&
        reason !== 'run-terminal' &&
        (reason !== 'not-activated' || deps.length === 0),
    )
    const parts: ReactNode[] = other.map(reasonText)
    if (deps.length > 0) {
      const units = unitsOf(deps, node)
      parts.unshift(
        <>
          {units.map((unit, index) => (
            <span key={unit.join('|')}>
              {index === 0 ? '' : index === units.length - 1 ? ' and ' : ', '}
              {unit.map((dep, at) => (
                <span key={dep}>
                  {at === 0 ? '' : ' or '}
                  <code>{dep}</code>
                </span>
              ))}
            </span>
          ))}{' '}
          to finish
        </>,
      )
    }
    if (parts.length > 0)
      return parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
        <span key={index}>
          {index === 0 ? '' : '; '}
          {part}
        </span>
      ))
  }
  return null
}

/**
 * One step of a run in words: what it is for, its status, its attempt, when it ran, what it
 * waits for, its input, output and error. The stored record sits behind "Raw record".
 */
export function StepPanel(props: {
  readonly run: RunDetail
  readonly wizard: WizardInfo | undefined
  readonly selected: string
  readonly onClose: () => void
}): ReactElement {
  const { run, selected } = props
  const box = useRef<HTMLElement>(null)
  const node = nodeOf(props.wizard?.manifest, selected)
  const record: StepRecordView | undefined = recordOf(run.snapshot as SnapshotLike, selected)
  const person = attentionOf(run).includes(selected)
  const live = !LIVE.has(run.status)
  const status = record?.status ?? 'idle'
  const outside =
    node?.kind === 'view' || node?.sleep !== undefined || (node?.waitsFor?.length ?? 0) > 0
  const word = stepWord(status, run.phases[selected], { person, ended: !live, outside })

  // biome-ignore lint/correctness/useExhaustiveDependencies: show the panel each time a step is chosen
  useEffect(() => {
    if (box.current !== null) bringIntoView(box.current)
  }, [selected])

  const started = status === 'idle' ? undefined : record?.enteredAt
  const ended = ['done', 'failed', 'skipped', 'cancelled', 'compensating', 'compensated'].includes(
    status,
  )
    ? record?.endedAt
    : undefined
  const attempts = node?.retry === undefined ? undefined : node.retry.retries + 1
  const attempt = record?.attempt ?? 0
  const hold = holdOf(run, selected, word, node ?? undefined)
  const label = selected.split('/').join(' / ')
  const chose = node?.dynamicNext === true ? choiceOf(run.events, selected) : undefined
  // A form's output is the input it accepted: one block, unless the two differ.
  const submitted =
    record?.input !== undefined && record.output !== undefined && same(record.input, record.output)
  const skipped = status === 'skipped'

  return (
    <section ref={box} className="card step-panel" aria-labelledby="step-panel-title">
      <header>
        <h2 id="step-panel-title">
          <code>{label}</code>
        </h2>
        <Status word={word} />
        <button type="button" className="close" onClick={props.onClose} aria-label="Close step">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      {node?.description !== undefined && <p className="quiet">{node.description}</p>}
      <dl className="facts">
        {kindOf(node) !== undefined && (
          <>
            <dt>Does</dt>
            <dd>{kindOf(node)}</dd>
          </>
        )}
        {attempts !== undefined && attempt > 0 && (
          <>
            <dt>Attempt</dt>
            <dd>
              {attempt} of {attempts}
            </dd>
          </>
        )}
        {skipped && (
          <>
            <dt>Skipped</dt>
            <dd>
              {record?.skipReason === undefined
                ? 'The run did not need it.'
                : sentence(SKIPPED[record.skipReason] ?? record.skipReason)}
            </dd>
          </>
        )}
        {(started !== undefined || (live && !skipped)) && (
          <>
            <dt>Started</dt>
            <dd>
              {started === undefined ? (
                'Not yet'
              ) : (
                <>
                  <When at={started} now={run.now} />
                  {ended === undefined && (
                    <span className="quiet"> · {duration(run.now - started)} so far</span>
                  )}
                </>
              )}
            </dd>
          </>
        )}
        {ended !== undefined && started !== undefined && (
          <>
            <dt>Ended</dt>
            <dd>
              <When at={ended} now={run.now} />
              <span className="quiet"> · took {duration(ended - started)}</span>
            </dd>
          </>
        )}
        {chose !== undefined && chose.length > 0 && (
          <>
            <dt>Chose</dt>
            <dd>
              {chose.map((target, index) => (
                <span key={target}>
                  {index === 0 ? '' : ', '}
                  <code>{target}</code>
                </span>
              ))}
            </dd>
          </>
        )}
        {hold !== null && (
          <>
            <dt>Waits for</dt>
            <dd>{hold}</dd>
          </>
        )}
      </dl>
      {record?.error !== undefined && (
        <p className="failure">{record.error.message ?? 'The step failed without a message.'}</p>
      )}
      {submitted ? (
        <div className="stack">
          <h3>Submitted</h3>
          <JsonView value={record?.output} />
        </div>
      ) : (
        <>
          {record?.input !== undefined && (
            <div className="stack">
              <h3>Input</h3>
              <JsonView value={record.input} />
            </div>
          )}
          {record?.output !== undefined && (
            <div className="stack">
              <h3>Output</h3>
              <JsonView value={record.output} />
            </div>
          )}
        </>
      )}
      {record === undefined ? (
        <p className="quiet">This step has no stored state yet.</p>
      ) : (
        <details className="raw">
          <summary>Raw record</summary>
          <JsonView value={record} />
        </details>
      )}
    </section>
  )
}

/**
 * Scrolls the page's scroll area just enough to show `item` below the sticky run header. It
 * never scrolls the document around the portal, and it jumps when the person asks for less
 * motion.
 */
export function bringIntoView(item: HTMLElement): void {
  const main = item.closest<HTMLElement>('.main')
  if (main === null) return
  const area = main.getBoundingClientRect()
  const box = item.getBoundingClientRect()
  const head = main.querySelector<HTMLElement>('.run-head')?.getBoundingClientRect().height ?? 0
  const top = area.top + head + 12
  // Enough of the panel to read its summary, without pushing the graph further than needed.
  const want = Math.min(box.bottom, box.top + 280)
  const delta = box.top < top ? box.top - top : Math.min(want - area.bottom + 16, box.top - top)
  if (delta < 1 && delta > -1) return
  if (delta < 0 && box.top >= top) return
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  main.scrollTo({ top: main.scrollTop + delta, behavior: calm ? 'auto' : 'smooth' })
}
