import { type KeyboardEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react'
import type { RunDetail } from '../wire'
import { Status } from './app'
import { useBackend } from './backend'
import { ago, clock, runTag } from './format'
import { Go, useNav } from './nav'

const TERMINAL = new Set(['done', 'failed', 'cancelled'])

/** The wall clock, read again every few seconds so a relative time stays true. */
function useNow(every = 10_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [every])
  return now
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
  readonly run: () => void
}

/** A "More" button whose menu closes on Escape, Tab, a choice or a click outside. */
function OverflowMenu({ items }: { readonly items: readonly MenuItem[] }): ReactElement {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (box.current !== null && !event.composedPath().includes(box.current)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
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
        onClick={() => setOpen(!open)}
      >
        More
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <div className="menu" role="menu" id={id} aria-label="More actions">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-danger={item.danger === true || undefined}
              onClick={() => {
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
  const now = useNow()
  const live = !TERMINAL.has(run.status)

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
            label: 'Stop and resume',
            hint: 'Disposes the run and resumes it from its snapshot, as a restarted process would.',
            run: () => void backend.act(run.id, { type: 'restart' }),
          },
          {
            label: 'Cancel run',
            hint: 'Ends the run with the status cancelled.',
            danger: true,
            run: () => void backend.act(run.id, { type: 'cancel' }),
          },
        ]
      : []),
    {
      label: 'Remove',
      hint: 'Deletes this run from the list.',
      danger: true,
      run: () => void remove(),
    },
  ]

  return (
    <header className="run-head">
      <div className="run-title">
        <h1>
          <Go to={{ page: 'wizard', name: run.wizard }}>{run.wizard}</Go>
        </h1>
        <Status status={run.status} />
      </div>
      <div className="run-actions">
        <button type="button" onClick={() => void again()}>
          Start again
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
        <span>
          {run.services === 'manual'
            ? 'You answer service calls'
            : 'Service calls go to the services in your dev config'}
        </span>
      </p>
    </header>
  )
}
