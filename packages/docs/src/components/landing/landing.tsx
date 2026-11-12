import { MDXProvider } from '@mdx-js/react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'
import { mdxComponents } from '../mdx/mdx-components'
import { RunDiagram } from '../run-diagram/run-diagram'
import { SiteHeader } from '../site-header'
import Example from './example.mdx'
import { agentPoints, extras, features } from './features'

/** The pitch, a run you can watch, the core features, the wizard that produced the run and the way forward. */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="landing">
        <p className="landing-name">{site.name}</p>
        <h1>
          <span className="landing-line">Define the workflow once.</span>{' '}
          <span className="landing-line">Get the orchestrator, the API and the docs.</span>
        </h1>
        <p className="landing-sentence">
          OpenWizard is a type-safe orchestrator for async work that calls services, waits for
          people and webhooks, retries, and resumes after a crash. From one TypeScript definition it
          generates the HTTP API, the signed webhook routes, the OpenAPI document and the
          documentation page, and it keeps every run in your own database.
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
          <h2>What one definition gives you</h2>
          <p>
            Each of these is usually a separate project: a job runner, an API layer, a webhook
            receiver, a docs page and a recovery plan. Here they come from the wizard.
          </p>
          <ul className="landing-features">
            {features.map((feature) => (
              <li key={feature.title}>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                {feature.to ? (
                  <Link to="/$" params={{ _splat: feature.to }}>
                    {feature.link}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                ) : null}
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
          <h2>Built for agentic work</h2>
          <p>
            Agents run workflows that outlive a request, and they write workflow code. Both need an
            orchestrator that checks its inputs and can explain itself.
          </p>
          <ul className="landing-features is-pair">
            {agentPoints.map((point) => (
              <li key={point.title}>
                <h3>{point.title}</h3>
                <p>{point.body}</p>
              </li>
            ))}
          </ul>
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
