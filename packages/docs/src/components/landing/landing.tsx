import { MDXProvider } from '@mdx-js/react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'
import { mdxComponents } from '../mdx/mdx-components'
import { RunDiagram } from '../run-diagram/run-diagram'
import { SiteHeader } from '../site-header'
import Example from './example.mdx'
import { extras, features } from './features'

/** The pitch, a run you can watch, the core features, the wizard that produced the run and the way forward. */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="landing">
        <p className="landing-name">{site.name}</p>
        <h1>
          <span className="landing-line">Write the whole flow once.</span>{' '}
          <span className="landing-line">Run it for a second or a month.</span>
        </h1>
        <p className="landing-sentence">
          Refunds, onboarding and approvals cross forms, service calls and days of waiting. Most
          teams build each one from status columns, cron jobs and retry code. OpenWizard runs the
          flow from one typed TypeScript definition and saves each run as JSON in your own database.
        </p>

        <div className="landing-hero-actions">
          <div className="landing-install">
            <span aria-hidden="true">$</span>
            <code>{site.installCommand}</code>
            <CopyButton
              text={site.installCommand}
              label="Copy install command"
              className="border-0 bg-transparent"
            />
          </div>
          <Link to="/$" params={{ _splat: 'quickstart' }} className="landing-action">
            Read the quickstart
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>

        <section className="landing-section">
          <h2>Watch a refund run</h2>
          <p>
            A customer asks for a refund while the order loads. A large refund waits for a manager,
            then the payment goes out. This is a recording of the real run, not a drawing. Press
            play, or pick the small refund.
          </p>
          <RunDiagram name="refund" />
        </section>

        <section className="landing-section">
          <h2>What you get</h2>
          <p>Six things you would otherwise build yourself, and rebuild for the next flow.</p>
          <ul className="landing-features">
            {features.map((feature) => (
              <li key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                <Link to="/$" params={{ _splat: feature.to }}>
                  {feature.link}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="landing-extras">
            Also included:{' '}
            {extras.map((extra, index) => (
              <span key={extra.to}>
                <Link to="/$" params={{ _splat: extra.to }}>
                  {extra.label}
                </Link>
                {index < extras.length - 1 ? ', ' : '.'}
              </span>
            ))}
          </p>
        </section>

        <section className="landing-section">
          <h2>The code that ran</h2>
          <p>
            This is the whole refund wizard, 48 lines. Each step in the diagram is one entry here,
            and <code>needs</code> draws the arrows.
          </p>
          <div className="docs-article landing-example">
            <MDXProvider components={mdxComponents}>
              <Example />
            </MDXProvider>
          </div>
        </section>

        <section className="landing-section landing-close">
          <h2>Ship the first flow today</h2>
          <p>
            The quickstart takes one install and one file. The playground runs wizards in the
            browser with nothing to install.
          </p>
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
