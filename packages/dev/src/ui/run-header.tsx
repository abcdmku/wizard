import {
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import type { RunDetail } from '../wire'
import { Status } from './app'
import { useBackend } from './backend'
import { ago, clock, runTag, span } from './format'
import { Go, useNav } from './nav'
import { useRunClock } from './run-clock'

const TERMINAL = new Set(['done', 'failed', 'cancelled'])
/** How long the note after a restart stays. The fade in run.css lasts as long. */
const NOTE_MS = 4000

/**
 * Watches a marker placed right above the sticky header. Once the marker leaves the scroll
 * area the header is stuck, and it turns compact.
 */
function useStuck(): [RefObject<HTMLSpanElement | null>, boolean] {
  const edge = useRef<HTMLSpanElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const marker = edge.current
    const root = marker?.closest('.main') ?? null
    if (marker === null || root === null || typeof IntersectionObserver === 'undefined') return
    const watch = new IntersectionObserver(
      ([entry]) => setStuck(entry !== undefined && !entry.isIntersecting),
      { root },
    )
    watch.observe(marker)
    return () => watch.disconnect()
  }, [])
  return [edge, stuck]
}

/** The short run id as a button that copies the full id. */
function CopyId({ id }: { readonly id: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const copy = () => {
    void navigator.clipboard
      ?.writeText(id)
      .then(() => setCopied(true))
      .catch(() => undefined)
  }
  return (
    <button
      type="button"
      className="copy-id"
      title={id}
      aria-label={`Copy run id ${id}`}
      onClick={copy}
    >
      <code>{runTag(id)}</code>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {copied ? (
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        ) : (
          <path d="M5.5 5.5V3.5h7v7h-2M3.5 5.5h7v7h-7z" />
        )}
      </svg>
      <span className="copied" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

interface MenuItem {
  readonly label: string
  readonly hint: string
  readonly danger?: boolean
  /** Asks once in place before it runs: the question, and the label of the button that keeps. */
  readonly confirm?: { readonly question: string; readonly keep: string }
  readonly run: () => void
}

/** A "More" button whose menu closes on Escape, Tab, a choice or a click outside. */
function OverflowMenu({ items }: { readonly items: readonly MenuItem[] }): ReactElement {
  const [open, setOpen] = useState(false)
  // The item whose question shows in place of the list.
  const [asking, setAsking] = useState<MenuItem>()
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (box.current !== null && !event.composedPath().includes(box.current)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  // Focus the first entry when the menu opens or switches between the list and a question.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `asking` swaps the entries to focus
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open, asking])

  const close = (refocus: boolean) => {
    setOpen(false)
    setAsking(undefined)
    if (refocus) trigger.current?.focus()
  }
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    const entries = [
      ...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
    ]
    const at = entries.indexOf(event.target as HTMLButtonElement)
    const to =
      event.key === 'ArrowDown'
        ? (at + 1) % entries.length
        : event.key === 'ArrowUp'
          ? (at - 1 + entries.length) % entries.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? entries.length - 1
              : -1
    if (to < 0) return
    event.preventDefault()
    entries[to]?.focus()
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys belong to the menu inside
    <div className="more" ref={box} onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        className="more-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        More
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {open && asking !== undefined && (
        <div className="menu" role="menu" id={id} aria-label={asking.confirm?.question}>
          <p className="menu-question" aria-hidden="true">
            {asking.confirm?.question}
          </p>
          <div className="menu-answers">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => setAsking(undefined)}
            >
              <span>{asking.confirm?.keep}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-danger
              onClick={() => {
                close(true)
                asking.run()
              }}
            >
              <span>{asking.label}</span>
            </button>
          </div>
        </div>
      )}
      {open && asking === undefined && (
        <div className="menu" role="menu" id={id} aria-label="More actions">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-danger={item.danger === true || undefined}
              onClick={() => {
                if (item.confirm !== undefined) {
                  setAsking(item)
                  return
                }
                close(true)
                item.run()
              }}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The run's name, status, actions and a line about where it came from. */
export function RunHeader({ run }: { readonly run: RunDetail }): ReactElement {
  const backend = useBackend()
  const nav = useNav()
  // The run's clock, which runs ahead of the wall clock once a timer is skipped.
  const { now, ahead } = useRunClock(run, 10_000)
  const live = !TERMINAL.has(run.status)
  const [edge, stuck] = useStuck()
  // A short note under the header after a restart, which fades on its own.
  const [note, setNote] = useState<{ readonly text: string; readonly at: number }>()
  useEffect(() => {
    if (note === undefined) return
    const timer = setTimeout(() => setNote(undefined), NOTE_MS)
    return () => clearTimeout(timer)
  }, [note])
  // The note is about the run as it was. Once the run moves to another status it is old news.
  const [noteStatus, setNoteStatus] = useState(run.status)
  if (noteStatus !== run.status) {
    setNoteStatus(run.status)
    if (note !== undefined && Date.now() - note.at > 600) setNote(undefined)
  }
  const restart = async () => {
    const result = await backend.act(run.id, { type: 'restart' })
    setNote({
      text: result.ok
        ? 'Restarted from snapshot. The run was stopped and resumed.'
        : `Restart failed: ${result.message ?? 'the run could not be resumed'}`,
      at: Date.now(),
    })
  }

  const again = async () => {
    const started = await backend.start({
      wizard: run.wizard,
      input: run.input,
      services: run.services,
    })
    if (started.ok && started.id !== undefined) nav.go({ page: 'run', id: started.id })
  }
  const remove = async () => {
    await backend.remove(run.id)
    nav.go({ page: 'wizard', name: run.wizard })
  }
  const items: MenuItem[] = [
    ...(live
      ? [
          {
            label: 'Restart from snapshot',
            hint: 'Stops the run and resumes it from its saved snapshot, as a restarted process would.',
            run: () => void restart(),
          },
          {
            label: 'Cancel run',
            hint: 'Ends the run with the status cancelled. Undo hooks run.',
            danger: true,
            confirm: { question: 'Cancel this run?', keep: 'Keep running' },
            run: () => void backend.act(run.id, { type: 'cancel' }),
          },
        ]
      : []),
    {
      label: 'Remove',
      hint: 'Deletes this run and its history from the list.',
      danger: true,
      confirm: { question: 'Remove this run?', keep: 'Keep' },
      run: () => void remove(),
    },
  ]

  return (
    <>
      <span ref={edge} className="run-edge" aria-hidden="true" />
      <header className="run-head" data-stuck={stuck || undefined}>
        <div className="run-title">
          <h1>
            <Go to={{ page: 'wizard', name: run.wizard }}>{run.wizard}</Go>
          </h1>
          <Status status={run.status} waiting={run.waiting} retrying={run.retrying} />
        </div>
        <div className="run-actions">
          <button
            type="button"
            title="Start another run with the same input"
            onClick={() => void again()}
          >
            New run
          </button>
          <OverflowMenu items={items} />
        </div>
        <p className="run-meta">
          <span>
            Run <CopyId id={run.id} />
          </span>
          <span>
            Started
            <time dateTime={new Date(run.createdAt).toISOString()} title={clock(run.createdAt)}>
              {ago(now - run.createdAt)}
            </time>
          </span>
          {ahead > 0 && (
            <span
              className="svc"
              title={`You skipped timers, so this run's clock is ${span(ahead)} ahead`}
            >
              clock +{span(ahead)}
            </span>
          )}
          <span
            className="svc"
            title={
              run.services === 'manual'
                ? 'Every service call waits for you to return a value or throw.'
                : 'Service calls go to the services in your dev config. A service it does not supply waits for you.'
            }
          >
            {run.services === 'manual' ? 'manual services' : 'configured services'}
          </span>
        </p>
        <p className="run-note" role="status">
          {note !== undefined && <span key={note.at}>{note.text}</span>}
        </p>
      </header>
    </>
  )
}
