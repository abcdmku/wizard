import { MDXProvider } from '@mdx-js/react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'
import { mdxComponents } from '../mdx/mdx-components'
import { RunDiagram } from '../run-diagram/run-diagram'
import { SiteHeader } from '../site-header'
import Example from './example.mdx'

/** One sentence, the install command, a run you can watch, the smallest wizard and the way forward. */
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

        <section className="landing-section">
          <h2>A refund, step by step</h2>
          <p>
            A customer asks for a refund while the order loads. A large refund waits for a manager.
            This is a recording of the real run. Press play, or pick the small refund.
          </p>
          <RunDiagram name="refund" />
        </section>

        <section className="landing-section">
          <h2>The smallest wizard</h2>
          <div className="docs-article landing-example">
            <MDXProvider components={mdxComponents}>
              <Example />
            </MDXProvider>
          </div>
        </section>

        <div className="landing-actions">
          <Link to="/$" params={{ _splat: 'quickstart' }} className="landing-action">
            Read the quickstart
            <ArrowRight aria-hidden="true" />
          </Link>
          <Link to="/playground" className="landing-action is-quiet">
            Open the playground
          </Link>
        </div>
      </main>
    </div>
  )
}
