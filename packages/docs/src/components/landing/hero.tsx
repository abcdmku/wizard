import { Link } from '@tanstack/react-router'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'

/** Right-aligned hero: the wordmark, the tagline, the install pill and a subdued docs link. */
export function Hero() {
  return (
    <div className="lg:w-[30vw] lg:max-w-[440px] lg:shrink-0 lg:text-right">
      <p className="mb-4 font-mono text-[11px] tracking-[0.22em] text-neutral-600 uppercase dark:text-neutral-400">
        Typed workflows
      </p>
      <h1
        className="text-6xl font-black leading-[0.92] text-ink lg:text-[clamp(3rem,5.2vw,6rem)] dark:text-white"
        style={{ letterSpacing: '-0.045em' }}
      >
        {site.name}
      </h1>
      <p className="mt-5 text-[15px] leading-relaxed text-neutral-500 lg:ml-auto lg:max-w-[70%] dark:text-neutral-400">
        {site.tagline}{' '}
        <span className="text-neutral-700 dark:text-neutral-300">
          Runs on the server, in the browser and at the edge.
        </span>
      </p>

      <div className="mt-5 inline-flex items-center gap-3 rounded-lg border border-neutral-200 bg-paper/70 px-4 py-2.5 font-mono text-[13px] text-neutral-500 lg:ml-auto dark:border-neutral-800 dark:bg-ink-2/70 dark:text-neutral-400">
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
          Read the docs &rarr;
        </Link>
      </div>
    </div>
  )
}
