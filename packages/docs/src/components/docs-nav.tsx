import { Link } from '@tanstack/react-router'
import { docsNavItems, docsPageMap, docsPages, docsSections, prefetchPage } from '../lib/docs'

function NavLink({
  slug,
  title,
  active,
  onNavigate,
}: {
  readonly slug: string
  readonly title: string
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
      className={`block rounded-md px-2 py-1 text-[13px] leading-6 transition-colors ${
        active
          ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100'
      }`}
    >
      {title}
    </Link>
  )
}

/** Left navigation built from the manifest: top-level pages and titled sections. */
export function DocsNav({
  currentSlug,
  onNavigate,
}: {
  readonly currentSlug: string
  readonly onNavigate?: (() => void) | undefined
}) {
  return (
    <nav className="space-y-6" aria-label="Documentation">
      {docsNavItems.map((item) => {
        if (item.type === 'page') {
          const page = docsPageMap.get(item.slug)
          if (!page) return null
          const children = docsPages.filter((candidate) => candidate.section === page.slug)
          return (
            <div key={`page-${page.slug}`} className="space-y-0.5">
              <NavLink
                slug={page.slug}
                title={page.title}
                active={page.slug === currentSlug}
                onNavigate={onNavigate}
              />
              {children.length > 0 && (
                <div className="ml-2 space-y-0.5 border-l border-neutral-200 pl-2 dark:border-neutral-800">
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
              )}
            </div>
          )
        }
        const section = docsSections.find((candidate) => candidate.id === item.id)
        if (!section) return null
        return (
          <section key={`section-${section.id}`} className="space-y-0.5">
            <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              {section.title}
            </h2>
            {section.slugs.map((slug) => {
              const page = docsPageMap.get(slug)
              return page ? (
                <NavLink
                  key={slug}
                  slug={slug}
                  title={page.title}
                  active={slug === currentSlug}
                  onNavigate={onNavigate}
                />
              ) : null
            })}
          </section>
        )
      })}
      <section className="space-y-0.5">
        <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Try it
        </h2>
        <Link
          to="/playground"
          onClick={onNavigate}
          className="block rounded-md px-2 py-1 text-[13px] leading-6 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-neutral-100"
        >
          Playground
        </Link>
      </section>
    </nav>
  )
}
