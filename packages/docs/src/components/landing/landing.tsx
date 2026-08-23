import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { site } from '../../lib/site'
import { GithubMark } from '../site-header'
import { ThemeToggle } from '../theme-toggle'
import { Hero } from './hero'
import { RecoveryPreview } from './recovery-preview'

const NAV_LINKS = [
  { label: 'Docs', slug: 'getting-started' },
  { label: 'Production', slug: 'advanced' },
  { label: 'Examples', slug: 'examples' },
] as const

export function Landing() {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <Link to="/" className="landing-wordmark" aria-label="OpenWizard home">
          <span>OW</span>
          {site.name}
        </Link>
        <nav aria-label="Main navigation">
          {NAV_LINKS.map((item) => (
            <Link key={item.slug} to="/$" params={{ _splat: item.slug }}>
              {item.label}
            </Link>
          ))}
          <Link to="/playground">Playground</Link>
        </nav>
        <div className="landing-header-actions">
          <a href={site.repositoryUrl} aria-label="OpenWizard on GitHub">
            <GithubMark />
          </a>
          <ThemeToggle />
          <Link to="/$" params={{ _splat: 'getting-started' }} className="landing-header-cta">
            Get started
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </header>

      <main>
        <section className="landing-hero-section">
          <Hero />
          <RecoveryPreview />
        </section>
      </main>
    </div>
  )
}
