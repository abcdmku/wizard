import { MDXProvider } from '@mdx-js/react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'
import { mdxComponents } from '../mdx/mdx-components'
import { SiteHeader } from '../site-header'
import Example from './example.mdx'

/** One sentence, the install command, the tested Quickstart example and one way forward. */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="landing">
        <h1>{site.name}</h1>
        <p className="landing-sentence">{site.description}</p>

        <div className="landing-install">
          <span aria-hidden="true">$</span>
          <code>{site.installCommand}</code>
          <CopyButton
            text={site.installCommand}
            label="Copy install command"
            className="border-0 bg-transparent"
          />
        </div>

        <div className="docs-article landing-example">
          <MDXProvider components={mdxComponents}>
            <Example />
          </MDXProvider>
        </div>

        <Link to="/$" params={{ _splat: 'quickstart' }} className="landing-action">
          Read the quickstart
          <ArrowRight aria-hidden="true" />
        </Link>
      </main>
    </div>
  )
}
