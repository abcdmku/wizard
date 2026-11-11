import { Link } from '@tanstack/react-router'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'

export function Hero() {
  return (
    <div className="lg:w-[31vw] lg:max-w-[460px] lg:shrink-0 lg:text-right">
      <p className="mb-4 font-mono text-[11px] tracking-[0.22em] text-neutral-600 uppercase dark:text-neutral-400">
        Durable workflows for TypeScript
      </p>
      <h1
        className="text-6xl font-black leading-[0.92] text-ink lg:text-[clamp(3rem,5.2vw,6rem)] dark:text-white"
        style={{ letterSpacing: '-0.045em' }}
      >
        {site.name}
      </h1>
      <p className="mt-5 text-[15px] leading-relaxed text-neutral-500 lg:ml-auto lg:max-w-[82%] dark:text-neutral-400">
        Typed workflows that pause for people and webhooks, retry without charging twice, and pick
        up where they left off after a crash. One wizard definition, many runs, plain TypeScript.
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

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 lg:justify-end">
        <Link
          to="/$"
          params={{ _splat: 'quickstart' }}
          className="text-[13px] font-medium text-neutral-500 no-underline transition-colors hover:text-ink dark:text-neutral-400 dark:hover:text-white"
        >
          Get started &rarr;
        </Link>
        <Link
          to="/$"
          params={{ _splat: 'production' }}
          className="text-[13px] font-medium text-neutral-500 no-underline transition-colors hover:text-ink dark:text-neutral-400 dark:hover:text-white"
        >
          See the production features &rarr;
        </Link>
      </div>
    </div>
  )
}
