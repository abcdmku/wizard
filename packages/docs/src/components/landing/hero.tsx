import { Link } from '@tanstack/react-router'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'

/** Right-aligned hero: the name, the two-tone tagline, the install pill and a subdued docs link. */
export function Hero() {
  return (
    <div className="lg:w-[31vw] lg:max-w-[520px] lg:shrink-0 lg:-translate-y-[8vh] lg:text-right">
      <h1
        className="text-5xl font-black leading-[0.92] text-ink lg:text-[clamp(3rem,5.2vw,6rem)] dark:text-white"
        style={{ letterSpacing: '-0.045em' }}
      >
        {site.name}
      </h1>
      <p className="mt-5 text-[15px] leading-relaxed text-neutral-500 lg:ml-auto lg:max-w-[60%] dark:text-neutral-400">
        A TypeScript-first, type-safe orchestrator for sync and async workflows.{' '}
        <span className="text-neutral-700 dark:text-neutral-300">
          On the server, in the browser, at the edge.
        </span>
      </p>

      <div className="mt-5 inline-flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-2.5 font-mono text-[13px] text-neutral-500 lg:ml-auto dark:border-neutral-800 dark:text-neutral-400">
        <span className="select-none text-neutral-300 dark:text-neutral-600">$</span>
        <span>{site.installCommand}</span>
        <CopyButton
          text={site.installCommand}
          label="Copy install command"
          className="border-0 bg-transparent px-1"
        />
      </div>

      <div className="mt-3 flex lg:justify-end">
        <Link
          to="/$"
          params={{ _splat: 'getting-started' }}
          className="text-[13px] font-medium text-neutral-400 no-underline transition-colors hover:text-ink dark:text-neutral-500 dark:hover:text-white"
        >
          View Docs &rarr;
        </Link>
      </div>
    </div>
  )
}
