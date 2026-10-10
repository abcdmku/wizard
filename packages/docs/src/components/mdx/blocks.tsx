import { AlertTriangle, Info, Lightbulb, OctagonAlert } from 'lucide-react'
import { Children, type ReactNode, useState } from 'react'

// ---------------------------------------------------------------------------
// Callout
// ---------------------------------------------------------------------------

type CalloutType = 'info' | 'tip' | 'warning' | 'danger'

const CALLOUT_ICON: Record<CalloutType, typeof Info> = {
  info: Info,
  tip: Lightbulb,
  warning: AlertTriangle,
  danger: OctagonAlert,
}

export function Callout({
  type = 'info',
  title,
  children,
}: {
  readonly type?: CalloutType
  readonly title?: string
  readonly children: ReactNode
}) {
  const Icon = CALLOUT_ICON[type]
  return (
    <aside
      className={`callout my-6 flex gap-3 rounded-lg border px-4 py-3 text-[14px] leading-6 ${
        type === 'warning' || type === 'danger'
          ? 'border-neutral-400 bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900'
          : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/60'
      }`}
    >
      <Icon className="mt-1 h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
      <div className="min-w-0 flex-1 [&>p]:my-1">
        {title && <p className="font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>}
        {children}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export function Steps({ children }: { readonly children: ReactNode }) {
  return (
    <ol className="steps my-8 list-none space-y-0 border-l border-neutral-200 pl-0 dark:border-neutral-800">
      {Children.toArray(children).map((child, index) => (
        <li key={index.toString()} className="relative my-0 pb-8 pl-8 last:pb-0">
          <span className="absolute -left-3.5 top-0 flex h-7 w-7 items-center justify-center rounded-full border border-neutral-300 bg-white font-mono text-xs text-neutral-700 dark:border-neutral-700 dark:bg-ink dark:text-neutral-200">
            {index + 1}
          </span>
          {child}
        </li>
      ))}
    </ol>
  )
}

export function Step({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div>
      <h3 className="!mt-0 mb-2 text-base font-semibold">{title}</h3>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs({
  items,
  children,
}: {
  readonly items: readonly string[]
  readonly children: ReactNode
}) {
  const [active, setActive] = useState(0)
  const panels = Children.toArray(children)
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div
        className="flex gap-1 border-b border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900/60"
        role="tablist"
      >
        {items.map((item, index) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active === index}
            onClick={() => setActive(index)}
            className={`rounded-md px-3 py-1.5 font-mono text-xs transition-colors ${
              active === index
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="px-4 [&_figure]:my-3 [&>p]:my-3">{panels[active]}</div>
    </div>
  )
}

export function Tab({ children }: { readonly label?: string; readonly children: ReactNode }) {
  return <>{children}</>
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export function Badge({ children }: { readonly children: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex items-center rounded border border-neutral-300 px-1.5 py-0.5 align-middle font-mono text-[11px] leading-none text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
      {children}
    </span>
  )
}
