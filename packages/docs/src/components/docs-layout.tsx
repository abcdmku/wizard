import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, ChevronRight, X } from 'lucide-react'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const { items, activeId } = useToc(articleRef)
  const progress = useReadingProgress(articleRef)
  const previous = siblingPage(page.slug, -1)
  const next = siblingPage(page.slug, 1)
  const section = docsSections.find((candidate) => candidate.id === page.section)

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <div className="docs-page-shell">
      <SiteHeader menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((open) => !open)} />
      <div className="docs-reading-progress" aria-hidden="true">
        <span style={{ width: `${progress * 100}%` }} />
      </div>

      {menuOpen && (
        <div className="docs-mobile-nav-layer">
          <button
            type="button"
            className="docs-mobile-nav-backdrop"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="docs-mobile-nav-panel">
            <div className="docs-mobile-nav-header">
              <span>Documentation</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close navigation"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <DocsNav currentSlug={page.slug} onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="docs-layout-grid">
        <aside className="docs-sidebar">
          <div className="docs-sidebar-sticky">
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
                <span>{items.length}</span>
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
