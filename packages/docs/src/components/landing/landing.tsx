import { Link } from '@tanstack/react-router'
import { site, withBase } from '../../lib/site'
import { Ide } from '../playground/ide'
import { landingSample } from '../playground/samples'
import { usePlayground } from '../playground/use-playground'
import { ThemeToggle } from '../theme-toggle'
import { Hero } from './hero'

const FOOTER_LINK =
  'no-underline transition-colors text-neutral-400 hover:text-ink dark:text-neutral-600 dark:hover:text-white'

/** Full-viewport, no-scroll canvas: hero on the left, the live IDE (16:10) on the right. */
export function Landing() {
  const playground = usePlayground(landingSample)
  const year = new Date().getUTCFullYear()

  return (
    <div className="landing-canvas flex min-h-screen flex-col lg:h-dvh lg:overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-8 px-6 py-8 lg:flex-row lg:items-center lg:justify-center lg:gap-12 lg:px-10 lg:py-0 xl:gap-16 xl:px-14">
        <Hero />

        <div className="flex min-w-0 flex-1 flex-col lg:items-center">
          <h2 className="mb-3 text-2xl font-bold tracking-tight text-ink lg:hidden dark:text-white">
            Try it live
          </h2>
          {/* One IDE instance: a fixed height on small screens; on desktop a 16:10 box whose width is
              driven by the column and capped by the viewport height, so it never overflows the hero. */}
          <div className="h-[560px] w-full overflow-hidden lg:aspect-[16/10] lg:h-auto lg:w-[min(100%,1080px,calc((100dvh-72px)*1.6))]">
            <Ide state={playground} title="OpenWizard IDE" />
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between px-6 py-3 text-[11px] text-neutral-400 lg:px-10 xl:px-14 dark:text-neutral-600">
        <span suppressHydrationWarning>&copy; {year} OpenWizard · MIT</span>
        <div className="flex items-center gap-4">
          <Link to="/$" params={{ _splat: 'getting-started' }} className={FOOTER_LINK}>
            Docs
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
