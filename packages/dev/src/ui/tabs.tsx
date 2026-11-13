import { type KeyboardEvent, type ReactElement, type ReactNode, useId, useRef } from 'react'

/** One tab: its id, its label and an optional count shown beside the label. */
export interface TabItem<T extends string> {
  readonly id: T
  readonly label: string
  readonly count?: number
}

/**
 * A row of tabs over one panel, wired for screen readers: `role="tablist"`, `aria-controls`
 * and a `role="tabpanel"` labelled by its tab. Arrow keys, Home and End move between tabs.
 */
export function Tabs<T extends string>(props: {
  /** Names the row for screen readers, such as "Run details". */
  readonly label: string
  readonly tabs: readonly TabItem<T>[]
  readonly selected: T
  readonly onSelect: (id: T) => void
  /** The selected tab's content. */
  readonly children: ReactNode
}): ReactElement {
  const base = useId()
  const list = useRef<HTMLDivElement>(null)
  const tabId = (id: T) => `${base}-tab-${id}`
  const panelId = `${base}-panel`

  const pick = (id: T) => {
    props.onSelect(id)
    const tab = list.current?.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)
    tab?.focus()
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const onKey = (event: KeyboardEvent) => {
    const index = props.tabs.findIndex((tab) => tab.id === props.selected)
    const last = props.tabs.length - 1
    const to =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined
    const next = to === undefined ? undefined : props.tabs[to]
    if (next === undefined) return
    event.preventDefault()
    pick(next.id)
  }

  return (
    <>
      <div ref={list} className="tabs" role="tablist" aria-label={props.label} onKeyDown={onKey}>
        {props.tabs.map((tab) => {
          const current = tab.id === props.selected
          return (
            <button
              key={tab.id}
              id={tabId(tab.id)}
              data-tab={tab.id}
              type="button"
              role="tab"
              aria-selected={current}
              aria-controls={panelId}
              tabIndex={current ? 0 : -1}
              onClick={() => pick(tab.id)}
            >
              {tab.label}
              {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
            </button>
          )
        })}
      </div>
      <section
        id={panelId}
        className="card tab-panel"
        role="tabpanel"
        aria-labelledby={tabId(props.selected)}
      >
        {props.children}
      </section>
    </>
  )
}
