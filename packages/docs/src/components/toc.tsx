import { type RefObject, useEffect, useState } from 'react'

interface TocItem {
  readonly id: string
  readonly text: string
  readonly level: number
}

/** Collects the article's h2/h3 headings (rehype-slug gives them ids) and tracks the visible one. */
export function useToc(articleRef: RefObject<HTMLElement | null>) {
  const [items, setItems] = useState<readonly TocItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    const article = articleRef.current
    if (!article) return
    const collect = () => {
      const headings = Array.from(article.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id]'))
      setItems(
        headings
          .filter((heading) => heading.textContent)
          .map((heading) => ({
            id: heading.id,
            text: heading.textContent ?? '',
            level: Number(heading.tagName.slice(1)),
          })),
      )
    }
    collect()
    const observer = new MutationObserver(collect)
    observer.observe(article, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [articleRef])

  useEffect(() => {
    const article = articleRef.current
    if (!article || items.length === 0) {
      setActiveId(null)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const first = visible[0]
        if (first) setActiveId(first.target.id)
      },
      { rootMargin: '-80px 0px -70% 0px' },
    )
    for (const item of items) {
      const element = article.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [articleRef, items])

  return { items, activeId }
}

export function Toc({
  items,
  activeId,
}: {
  readonly items: readonly TocItem[]
  readonly activeId: string | null
}) {
  if (items.length === 0) return null
  return (
    <nav aria-label="On this page">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        On this page
      </h2>
      <ul className="space-y-0.5 border-l border-neutral-200 text-[12.5px] dark:border-neutral-800">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`-ml-px block border-l py-1 pr-2 leading-5 transition-colors ${
                item.level === 3 ? 'pl-6' : 'pl-3'
              } ${
                activeId === item.id
                  ? 'border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                  : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
              }`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
