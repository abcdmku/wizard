import { Link } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { type DocsPage, prefetchPage, siblingPage } from '../lib/docs'
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
  return (
    <Link
      to="/$"
      params={{ _splat: page.slug }}
      preload="intent"
      onMouseEnter={prefetch}
      onFocus={prefetch}
      className={`group flex flex-col gap-1 rounded-lg border border-neutral-200 px-4 py-3 text-sm transition-colors hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600 ${
        direction === 'next' ? 'items-end text-right' : 'items-start'
      }`}
    >
      <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-neutral-500">
        {direction === 'prev' && <ArrowLeft className="h-3 w-3" />}
        {direction === 'prev' ? 'Previous' : 'Next'}
        {direction === 'next' && <ArrowRight className="h-3 w-3" />}
      </span>
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{page.title}</span>
    </Link>
  )
}

/** Header + left nav + article + right ToC + prev/next pager, for every MDX page. */
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
  const previous = siblingPage(page.slug, -1)
  const next = siblingPage(page.slug, 1)

  return (
    <div className="min-h-screen">
      <SiteHeader menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((open) => !open)} />

      {menuOpen && (
        <div className="border-b border-neutral-200 px-4 py-4 lg:hidden dark:border-neutral-800">
          <DocsNav currentSlug={page.slug} onNavigate={() => setMenuOpen(false)} />
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-10 px-4 py-8 lg:grid-cols-[240px_minmax(0,1fr)_200px] lg:px-6">
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
            <DocsNav currentSlug={page.slug} />
          </div>
        </aside>

        <main className="min-w-0">
          <article ref={articleRef} className="docs-article mx-auto max-w-3xl" data-pagefind-body>
            {children}
          </article>
          <div className="mx-auto mt-14 grid max-w-3xl grid-cols-1 gap-3 border-t border-neutral-200 pt-6 sm:grid-cols-2 dark:border-neutral-800">
            <div>{previous && <PagerLink page={previous} direction="prev" />}</div>
            <div>{next && <PagerLink page={next} direction="next" />}</div>
          </div>
          <p className="mx-auto mt-6 max-w-3xl text-xs text-neutral-500">
            <a
              href={`${site.editBase}/${page.sourcePath}`}
              className="hover:text-neutral-900 dark:hover:text-neutral-200"
            >
              Edit this page on GitHub
            </a>
          </p>
        </main>

        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
            <Toc items={items} activeId={activeId} />
          </div>
        </aside>
      </div>
    </div>
  )
}
