import { MDXProvider } from '@mdx-js/react'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'
import { mdxComponents } from '../mdx/mdx-components'
import { Portal } from '../portal/portal'
import { SiteHeader } from '../site-header'
import Example from './example.mdx'
import { agentPoints, extras, outputs, replacements } from './features'

/** The pitch, what you stop maintaining, the dev UI with a run to drive, what the wizard generates, why agents need it and the code. */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="landing">
        <p className="landing-name">{site.name}</p>
        <h1>
          <span className="landing-line">Create business logic that auto generates</span>{' '}
          <span className="landing-line">APIs, webhooks and documentation.</span>
        </h1>
        <p className="landing-sentence">
          One TypeScript file becomes a type-checked orchestrator, an HTTP API, signed webhooks and
          its own docs. Runs survive crashes and deploys. Built for complex work and the agents
          implementing it.
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
          <h2>What it replaces</h2>
          <p>Each chore on the left becomes the line on the right.</p>
          <ul className="landing-replaces">
            {replacements.map((item) => (
              <li key={item.chore}>
                <span>{item.chore}</span>
                <ArrowRight aria-hidden="true" />
                <code>{item.code}</code>
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section">
          <h2>Run it by hand</h2>
          <p>
            <code>npx openwizard dev</code> opens this UI on your machine. Here it runs in the page
            with five wizards: a refund, a research agent, a new hire, an incident and a deploy.
          </p>
          <Portal name="home" />
          <div className="landing-actions">
            <Link to="/$" params={{ _splat: 'guide/dev' }} className="landing-action is-quiet">
              Read about the dev server
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section className="landing-section">
          <h2>That one file also produced this</h2>
          <p>Real output from the same refund wizard. None of it is written by hand.</p>
          <ul className="landing-features">
            {outputs.map((output) => (
              <li key={output.title}>
                <h3>{output.title}</h3>
                <p>{output.body}</p>
                <pre className="landing-output">
                  {output.lines.map((line) => (
                    <span key={line.text} data-tone={line.tone}>
                      {line.text}
                    </span>
                  ))}
                </pre>
                <Link to="/$" params={{ _splat: output.to }}>
                  {output.link}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="landing-extras">
            Also in the box:{' '}
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
          <h2>Built for agents</h2>
          <dl className="landing-agents">
            {agentPoints.map((point) => (
              <div key={point.claim}>
                <dt>{point.claim}</dt>
                <dd>{point.answer}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="landing-section">
          <h2>The whole file</h2>
          <p>
            48 lines. Each step in the diagram is one entry, and <code>needs</code> draws the
            arrows.
          </p>
          <div className="docs-article landing-example">
            <MDXProvider components={mdxComponents}>
              <Example />
            </MDXProvider>
          </div>
        </section>

        <section className="landing-section landing-close">
          <h2>Ship the first one today</h2>
          <p>One install, one file. Or run a wizard in the browser right now.</p>
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
