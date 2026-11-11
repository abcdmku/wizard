import { Link } from '@tanstack/react-router'
import { site, withBase } from '../../lib/site'
import { ThemeToggle } from '../theme-toggle'
import { Hero } from './hero'
import { RecoveryPreview } from './recovery-preview'

const FOOTER_LINK =
  'no-underline transition-colors text-neutral-400 hover:text-ink dark:text-neutral-600 dark:hover:text-white'

export function Landing() {
  const year = new Date().getUTCFullYear()

  return (
    <div className="landing-canvas flex min-h-screen flex-col lg:h-dvh lg:overflow-hidden">
      <main className="relative flex min-h-0 flex-1 flex-col gap-12 px-6 py-10 lg:flex-row lg:items-center lg:justify-center lg:gap-14 lg:px-10 lg:py-0 xl:gap-20 xl:px-14">
        <Hero />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:items-start">
          <div className="mb-4 lg:hidden">
            <h2 className="text-2xl font-bold tracking-tight text-ink dark:text-white">
              Crash a run, then resume it
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              A real run in your browser: start it, kill the process mid-charge, resume from the
              snapshot, and deliver the review event.
            </p>
          </div>
          <div className="h-[590px] w-full max-w-[720px] lg:h-[min(76dvh,690px)]">
            <RecoveryPreview />
          </div>
        </div>
      </main>

      <footer className="flex shrink-0 items-center justify-between px-6 py-3 text-[11px] text-neutral-400 lg:px-10 xl:px-14 dark:text-neutral-600">
        <span suppressHydrationWarning>&copy; {year} OpenWizard, MIT</span>
        <div className="flex items-center gap-4">
          <Link to="/$" params={{ _splat: 'getting-started' }} className={FOOTER_LINK}>
            Docs
          </Link>
          <Link to="/$" params={{ _splat: 'advanced' }} className={FOOTER_LINK}>
            Production
          </Link>
          <Link to="/$" params={{ _splat: 'examples' }} className={FOOTER_LINK}>
            Examples
          </Link>
          <Link to="/playground" className={FOOTER_LINK}>
            Playground
          </Link>
          <a href={withBase('/typedoc/')} className={FOOTER_LINK}>
            API
          </a>
          <a href={site.repositoryUrl} className={FOOTER_LINK}>
            GitHub
          </a>
          <ThemeToggle className="scale-90" />
        </div>
      </footer>
    </div>
  )
}
