import { Link } from '@tanstack/react-router'
import { ChevronRight, FlaskConical } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { docsNavItems, docsPageMap, docsPages, docsSections, prefetchPage } from '../lib/docs'

function NavLink({
  slug,
  title,
  number,
  active,
  onNavigate,
}: {
  readonly slug: string
  readonly title: string
  /** The page's place in a section that is read in order. */
  readonly number?: number | undefined
  readonly active: boolean
  readonly onNavigate?: (() => void) | undefined
}) {
  const prefetch = () => prefetchPage(slug)
  return (
    <Link
      to="/$"
      params={{ _splat: slug }}
      preload="intent"
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`docs-nav-link ${active ? 'docs-nav-link-active' : ''}`}
    >
      <span>
        {number !== undefined && <span className="docs-nav-number">{number}</span>}
        {title}
      </span>
      {active && <span className="docs-nav-active-dot" aria-hidden="true" />}
    </Link>
  )
}

export function DocsNav({
  currentSlug,
  onNavigate,
}: {
  readonly currentSlug: string
  readonly onNavigate?: (() => void) | undefined
}) {
  const navRef = useRef<HTMLElement | null>(null)

  // The list is taller than most screens, so bring the current page into view inside its scroller.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again when the page changes
  useEffect(() => {
    // Wait a frame, so the list is measured after layout has settled.
    const frame = requestAnimationFrame(() => {
      const link = navRef.current?.querySelector<HTMLElement>('.docs-nav-link-active')
      const scroller = link?.closest<HTMLElement>('[data-nav-scroller]')
      if (!link || !scroller) return
      const box = scroller.getBoundingClientRect()
      const rect = link.getBoundingClientRect()
      if (rect.top < box.top + 48 || rect.bottom > box.bottom - 64) {
        scroller.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [currentSlug])

  return (
    <nav ref={navRef} className="docs-nav" aria-label="Documentation">
      <p className="docs-nav-eyebrow">Browse</p>
      {docsNavItems.map((item) => {
        if (item.type === 'page') {
          const page = docsPageMap.get(item.slug)
          if (!page) return null
          const children = docsPages.filter((candidate) => candidate.section === page.slug)
          return (
            <div key={`page-${page.slug}`} className="docs-nav-start">
              <NavLink
                slug={page.slug}
                title={page.title}
                active={page.slug === currentSlug}
                onNavigate={onNavigate}
              />
              {children.map((child) => (
                <NavLink
                  key={child.slug}
                  slug={child.slug}
                  title={child.title}
                  active={child.slug === currentSlug}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          )
        }

        const section = docsSections.find((candidate) => candidate.id === item.id)
        if (!section) return null
        return (
          <details key={section.id} className="docs-nav-section" open>
            <summary>
              <span>{section.title}</span>
              <ChevronRight aria-hidden="true" />
            </summary>
            <div className="docs-nav-section-links">
              {section.slugs.map((slug, index) => {
                const page = docsPageMap.get(slug)
                return page ? (
                  <NavLink
                    key={slug}
                    slug={slug}
                    title={page.title}
                    number={section.numbered ? index + 1 : undefined}
                    active={slug === currentSlug}
                    onNavigate={onNavigate}
                  />
                ) : null
              })}
            </div>
          </details>
        )
      })}

      <Link to="/playground" onClick={onNavigate} className="docs-nav-playground">
        <FlaskConical aria-hidden="true" />
        <span>
          Try it in the browser
          <small className="docs-nav-playground-detail">Edit and run a wizard</small>
        </span>
        <ChevronRight aria-hidden="true" />
      </Link>
    </nav>
  )
}
