import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react'

/**
 * Scrolls `box` just enough to show `item`, sideways or down. Unlike `scrollIntoView` it never
 * moves the page around `box`, which matters when the UI sits inside a docs page.
 */
export function reveal(box: HTMLElement, item: HTMLElement): void {
  const outer = box.getBoundingClientRect()
  const inner = item.getBoundingClientRect()
  const pad = 24
  if (box.scrollWidth > box.clientWidth) {
    if (inner.left < outer.left + pad) box.scrollLeft -= outer.left + pad - inner.left
    else if (inner.right > outer.right - pad) box.scrollLeft += inner.right - outer.right + pad
  }
  if (box.scrollHeight > box.clientHeight) {
    if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top
    else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom
  }
}

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
  /** Classes for the panel besides `card tab-panel`. */
  readonly panelClass?: string
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
  }
  // Keep the selected tab in view when the row scrolls sideways, as it does on a phone.
  useEffect(() => {
    const box = list.current
    const tab = box?.querySelector<HTMLElement>(`[data-tab="${props.selected}"]`)
    if (box && tab) reveal(box, tab)
  }, [props.selected])
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
        className={`card tab-panel${props.panelClass === undefined ? '' : ` ${props.panelClass}`}`}
        role="tabpanel"
        aria-labelledby={tabId(props.selected)}
      >
        {props.children}
      </section>
    </>
  )
}
