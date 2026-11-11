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
  showTitle = true,
}: {
  readonly items: readonly TocItem[]
  readonly activeId: string | null
  readonly showTitle?: boolean
}) {
  if (items.length === 0) return null
  return (
    <nav aria-label="On this page" className="docs-toc">
      {showTitle && <h2>On this page</h2>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`${item.level === 3 ? 'docs-toc-link-nested' : ''} ${
                activeId === item.id ? 'docs-toc-link-active' : ''
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
