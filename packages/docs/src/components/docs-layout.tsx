import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { docsPageMap, type DocsPage } from '@/generated/docs-manifest'
import { docsNavigation, getDocSibling } from '@/lib/docs'
import { prefetchDocModuleBySlug } from '@/lib/docs-modules'
import { siteConfig } from '@/config/site'
import { SearchDialog } from '@/components/search-dialog'
import { withBase } from '@/lib/base-path'
import { useTheme } from '@/theme/theme-provider'

type TocItem = {
  id: string
  text: string
  level: number
}

function ThemeToggle() {
  const { ready, theme, toggleTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
      aria-label="Toggle theme"
    >
      {!ready ? 'Theme' : theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}

function NavLink({ slug, title, active }: { slug: string; title: string; active: boolean }) {
  const prefetchPage = () => {
    prefetchDocModuleBySlug(slug)
  }

  return (
    <Link
      to="/$"
      params={{ _splat: slug }}
      preload="intent"
      onMouseEnter={prefetchPage}
      onFocus={prefetchPage}
      onTouchStart={prefetchPage}
      className={`block rounded-md px-2 py-1.5 text-sm transition ${
        active
          ? 'bg-slate-100 font-semibold text-slate-900 dark:bg-slate-900 dark:text-slate-100'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
      }`}
    >
      {title}
    </Link>
  )
}

export function DocsLayout({ page, children }: { page: DocsPage; children: React.ReactNode }) {
  const articleRef = useRef<HTMLElement | null>(null)
  const [tocItems, setTocItems] = useState<TocItem[]>([])
  const [activeHeading, setActiveHeading] = useState<string | null>(null)

  const previousPage = useMemo(() => getDocSibling(page.slug, -1), [page.slug])
  const nextPage = useMemo(() => getDocSibling(page.slug, 1), [page.slug])
  const editUrl = `${siteConfig.docsRepositoryBase}/${page.editPath}`
  const sectionsById = useMemo(
    () => Object.fromEntries(docsNavigation.sections.map((section) => [section.id, section])),
    [],
  )

  useEffect(() => {
    const article = articleRef.current
    if (!article) return

    const collectHeadings = () => {
      const headingNodes = Array.from(article.querySelectorAll('h2, h3'))
      const nextItems = headingNodes
        .map((node) => {
          const element = node as HTMLHeadingElement
          if (!element.id) {
            const generatedId = element.textContent
              ?.toLowerCase()
              .replace(/[^a-z0-9\s-]/g, '')
              .trim()
              .replace(/\s+/g, '-')
            if (generatedId) {
              element.id = generatedId
            }
          }
          if (!element.id || !element.textContent) return null
          return {
            id: element.id,
            text: element.textContent,
            level: Number(element.tagName.replace('H', '')),
          } satisfies TocItem
        })
        .filter(Boolean) as TocItem[]

      setTocItems(nextItems)
    }

    collectHeadings()
    const observer = new MutationObserver(collectHeadings)
    observer.observe(article, {
      childList: true,
      subtree: true,
    })

    return () => observer.disconnect()
  }, [page.slug])

  useEffect(() => {
    const article = articleRef.current
    if (!article || tocItems.length === 0) {
      setActiveHeading(null)
      return
    }

    const headingElements = tocItems
      .map((item) => article.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`))
      .filter(Boolean) as HTMLElement[]

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)

        if (visible.length > 0) {
          setActiveHeading(visible[0].target.id)
        }
      },
      {
        rootMargin: '0px 0px -70% 0px',
      },
    )

    headingElements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [tocItems])

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-[#0a0a0a] dark:text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-[#0a0a0a]/95">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm font-semibold tracking-tight">
              {siteConfig.title}
            </Link>
            <a
              href={withBase('/typedoc/')}
              className="hidden text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 md:inline"
            >
              TypeDoc
            </a>
            <a
              href={siteConfig.repositoryUrl}
              className="hidden text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 md:inline"
            >
              GitHub
            </a>
          </div>

          <div className="flex items-center gap-2">
            <SearchDialog />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-8 px-4 py-8 lg:grid-cols-[260px_minmax(0,1fr)_220px]">
        <aside className="hidden lg:block">
          <nav className="sticky top-20 space-y-6">
            {docsNavigation.navItems.map((entry) => {
              if (entry.type === 'page') {
                const topPage = docsPageMap[entry.slug]
                if (!topPage) return null

                const childPages = docsNavigation.pages.filter((item) => item.section === topPage.slug)

                return (
                  <div key={`page-${topPage.slug}`} className="space-y-1">
                    <NavLink
                      slug={topPage.slug}
                      title={topPage.title}
                      active={topPage.slug === page.slug}
                    />
                    {childPages.length > 0 && (
                      <div className="ml-3 space-y-1 border-l border-slate-200 pl-2 dark:border-slate-800">
                        {childPages.map((childPage) => (
                          <NavLink
                            key={childPage.slug}
                            slug={childPage.slug}
                            title={childPage.title}
                            active={childPage.slug === page.slug}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              }

              const section = sectionsById[entry.id]
              if (!section) return null

              return (
                <section key={`section-${section.id}`} className="space-y-1">
                  <h2 className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {section.title}
                  </h2>
                  {section.slugs.map((slug) => {
                    const sectionPage = docsPageMap[slug]
                    if (!sectionPage) return null
                    return (
                      <NavLink
                        key={sectionPage.slug}
                        slug={sectionPage.slug}
                        title={sectionPage.title}
                        active={sectionPage.slug === page.slug}
                      />
                    )
                  })}
                </section>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0">
          <article ref={articleRef} className="docs-article mx-auto max-w-3xl">
            {children}
          </article>

          <div className="mx-auto mt-12 flex max-w-3xl items-center justify-between gap-4 border-t border-slate-200 pt-6 dark:border-slate-800">
            <div className="min-h-[44px]">
              {previousPage ? (
                <Link
                  to="/$"
                  params={{ _splat: previousPage.slug }}
                  preload="intent"
                  onMouseEnter={() => prefetchDocModuleBySlug(previousPage.slug)}
                  onFocus={() => prefetchDocModuleBySlug(previousPage.slug)}
                  onTouchStart={() => prefetchDocModuleBySlug(previousPage.slug)}
                  className="block text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Previous
                  </div>
                  {previousPage.title}
                </Link>
              ) : null}
            </div>

            <div className="min-h-[44px] text-right">
              {nextPage ? (
                <Link
                  to="/$"
                  params={{ _splat: nextPage.slug }}
                  preload="intent"
                  onMouseEnter={() => prefetchDocModuleBySlug(nextPage.slug)}
                  onFocus={() => prefetchDocModuleBySlug(nextPage.slug)}
                  onTouchStart={() => prefetchDocModuleBySlug(nextPage.slug)}
                  className="block text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Next
                  </div>
                  {nextPage.title}
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mx-auto mt-6 max-w-3xl text-xs text-slate-500 dark:text-slate-400">
            <a href={editUrl} className="hover:text-slate-900 dark:hover:text-slate-200">
              Edit this page on GitHub
            </a>
          </div>
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/40">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              On this page
            </h2>
            <ul className="space-y-1 text-sm">
              {tocItems.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className={`block rounded px-2 py-1 transition ${
                      activeHeading === item.id
                        ? 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                        : 'text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800'
                    } ${item.level === 3 ? 'ml-2' : ''}`}
                  >
                    {item.text}
                  </a>
                </li>
              ))}
              {tocItems.length === 0 && (
                <li className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
                  No headings found.
                </li>
              )}
            </ul>

            <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <a href={siteConfig.discordUrl} className="hover:text-slate-900 dark:hover:text-slate-200">
                Questions? Join Discord.
              </a>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
