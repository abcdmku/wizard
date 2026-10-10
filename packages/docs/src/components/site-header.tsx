import { Link } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { site, withBase } from '../lib/site'
import { SearchDialog } from './search-dialog'
import { ThemeToggle } from './theme-toggle'

const TOP_LINKS = [
  { label: 'Docs', slug: 'getting-started' },
  { label: 'Concepts', slug: 'concepts' },
  { label: 'Examples', slug: 'examples' },
  { label: 'API', slug: 'api' },
] as const

interface SiteHeaderProps {
  /** Mobile navigation drawer state (only the docs layout has one). */
  readonly menuOpen?: boolean
  readonly onToggleMenu?: () => void
}

/** Sticky top bar shared by the docs pages and the playground. */
export function SiteHeader({ menuOpen = false, onToggleMenu }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-ink/90">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-4 px-4 lg:px-6">
        <div className="flex items-center gap-5">
          {onToggleMenu && (
            <button
              type="button"
              onClick={onToggleMenu}
              aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
              className="-ml-1 rounded p-1 text-neutral-600 lg:hidden dark:text-neutral-300"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
          <Link to="/" className="text-sm font-bold tracking-tight">
            {site.name}
          </Link>
          <nav className="hidden items-center gap-4 text-[13px] text-neutral-500 md:flex dark:text-neutral-400">
            {TOP_LINKS.map((link) => (
              <Link
                key={link.slug}
                to="/$"
                params={{ _splat: link.slug }}
                className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
                activeProps={{ className: 'text-neutral-900 dark:text-neutral-100' }}
                activeOptions={{ exact: false }}
              >
                {link.label}
              </Link>
            ))}
            <Link
              to="/playground"
              className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
              activeProps={{ className: 'text-neutral-900 dark:text-neutral-100' }}
            >
              Playground
            </Link>
            <a
              href={withBase('/typedoc/')}
              className="transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              TypeDoc
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <SearchDialog />
          <a
            href={site.repositoryUrl}
            aria-label="GitHub repository"
            className="rounded-full p-1.5 text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            <GithubMark className="h-4 w-4" />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

/** The GitHub mark (lucide dropped brand icons). */
export function GithubMark({ className = '' }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
