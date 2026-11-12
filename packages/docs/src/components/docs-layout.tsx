import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { type DocsPage, docsSections, prefetchPage, siblingPage } from '../lib/docs'
import { site } from '../lib/site'
import { DocsNav } from './docs-nav'
import { SiteHeader } from './site-header'
import { Toc, useToc } from './toc'

function PagerLink({
  page,
  direction,
}: {
  readonly page: DocsPage
  readonly direction: 'prev' | 'next'
}) {
  const prefetch = () => prefetchPage(page.slug)
  const section = docsSections.find((candidate) => candidate.id === page.section)
  const title = section ? `${section.title} / ${page.title}` : page.title
  return (
    <Link
      to="/$"
      params={{ _splat: page.slug }}
      preload="intent"
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className={`docs-pager-link ${direction === 'next' ? 'docs-pager-link-next' : ''}`}
    >
      <span className="docs-pager-direction">
        {direction === 'prev' && <ArrowLeft aria-hidden="true" />}
        {direction === 'prev' ? 'Previous' : 'Next'}
        {direction === 'next' && <ArrowRight aria-hidden="true" />}
      </span>
      <strong>{title}</strong>
    </Link>
  )
}

function useReadingProgress(articleRef: RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const article = articleRef.current
        if (!article) return
        const top = article.getBoundingClientRect().top + window.scrollY - 96
        const distance = Math.max(article.offsetHeight - window.innerHeight + 180, 1)
        const next = Math.min(1, Math.max(0, (window.scrollY - top) / distance))
        setProgress(next)
      })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [articleRef])

  return progress
}

export function DocsLayout({
  page,
  children,
}: {
  readonly page: DocsPage
  readonly children: ReactNode
}) {
  const articleRef = useRef<HTMLElement | null>(null)
  const { items, activeId } = useToc(articleRef)
  const progress = useReadingProgress(articleRef)
  const previous = siblingPage(page.slug, -1)
  const next = siblingPage(page.slug, 1)
  const section = docsSections.find((candidate) => candidate.id === page.section)

  return (
    <div className="docs-page-shell">
      <SiteHeader currentSlug={page.slug} />
      <div className="docs-reading-progress" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="docs-layout-grid">
        <aside className="docs-sidebar">
          <div className="docs-sidebar-sticky" data-nav-scroller>
            <DocsNav currentSlug={page.slug} />
          </div>
        </aside>

        <main className="docs-main">
          <nav className="docs-breadcrumb" aria-label="Breadcrumb">
            {section ? (
              <Link to="/$" params={{ _splat: section.id }}>
                {section.title}
              </Link>
            ) : (
              <span>Documentation</span>
            )}
            <ChevronRight aria-hidden="true" />
            <span>{page.title}</span>
          </nav>

          {items.length > 0 && (
            <details className="docs-mobile-toc">
              <summary>
                On this page
                <span className="docs-mobile-toc-count">{items.length}</span>
              </summary>
              <Toc items={items} activeId={activeId} showTitle={false} />
            </details>
          )}

          <article ref={articleRef} className="docs-article" data-pagefind-body>
            {children}
          </article>

          <div className="docs-pager">
            <div>{previous && <PagerLink page={previous} direction="prev" />}</div>
            <div>{next && <PagerLink page={next} direction="next" />}</div>
          </div>
          <div className="docs-page-footer">
            <span>Found a gap?</span>
            <a href={`${site.editBase}/${page.sourcePath}`}>Edit this page on GitHub</a>
          </div>
        </main>

        <aside className="docs-toc-sidebar">
          <div className="docs-toc-sticky">
            <Toc items={items} activeId={activeId} />
          </div>
        </aside>
      </div>
    </div>
  )
}
