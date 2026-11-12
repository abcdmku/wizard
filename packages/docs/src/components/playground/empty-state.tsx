import type { ReactNode } from 'react'

/** What a preview tab shows before it has anything: what belongs here and how to get it. */
export function EmptyState({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
      <p className="font-mono text-xs font-medium text-neutral-800 dark:text-neutral-200">
        {title}
      </p>
      <p className="max-w-[22rem] text-[13px] leading-5 text-neutral-500 dark:text-neutral-400">
        {children}
      </p>
    </div>
  )
}
