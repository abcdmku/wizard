import { Link } from '@tanstack/react-router'
import { Menu, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { site } from '../lib/site'
import { MobileNav } from './mobile-nav'
import { SearchDialog } from './search-dialog'
import { ThemeToggle } from './theme-toggle'

const TOP_LINKS = [
  { label: 'Quickstart', slug: 'quickstart' },
  { label: 'Guide', slug: 'guide' },
  { label: 'Production', slug: 'production' },
  { label: 'Reference', slug: 'reference' },
  { label: 'Examples', slug: 'examples' },
] as const

interface SiteHeaderProps {
  /** The docs page being read. Pages without a sidebar, such as the home page, leave it out. */
  readonly currentSlug?: string
}

export function SiteHeader({ currentSlug }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  // A page without a sidebar needs the menu as soon as the top links no longer fit.
  const standalone = currentSlug === undefined
  return (
    <header className={`site-header ${standalone ? 'site-header-standalone' : ''}`}>
      <div className="site-header-inner">
        <div className="site-header-brand-group">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            className="site-menu-button"
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
          <Link to="/" className="site-wordmark" aria-label="OpenWizard home">
            <span>OW</span>
            <strong>{site.name}</strong>
          </Link>
          <span className="site-header-divider" aria-hidden="true" />
          <span className="site-header-context">Documentation</span>
        </div>

        <nav className="site-header-nav" aria-label="Documentation sections">
          {TOP_LINKS.map((link) => (
            <Link
              key={link.slug}
              to="/$"
              params={{ _splat: link.slug }}
              activeProps={{ className: 'site-header-nav-active' }}
              activeOptions={{ exact: false }}
            >
              {link.label}
            </Link>
          ))}
          <Link to="/playground" activeProps={{ className: 'site-header-nav-active' }}>
            Playground
          </Link>
        </nav>

        <div className="site-header-actions">
          <SearchDialog />
          <a href={site.repositoryUrl} aria-label="GitHub repository" className="site-icon-action">
            <GithubMark />
          </a>
          <ThemeToggle className="site-theme-toggle" />
        </div>
      </div>
      {menuOpen && <MobileNav currentSlug={currentSlug ?? ''} onClose={closeMenu} />}
    </header>
  )
}

function GithubMark({ className = '' }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
