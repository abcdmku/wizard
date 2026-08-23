import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Terminal } from 'lucide-react'
import { site } from '../../lib/site'
import { CopyButton } from '../mdx/copy-button'

export function Hero() {
  return (
    <div className="landing-hero-copy">
      <div className="landing-kicker">
        <span className="landing-kicker-mark" aria-hidden="true" />
        Durable workflows for TypeScript
      </div>

      <h1>Your process died. The workflow didn't.</h1>

      <p className="landing-hero-summary">
        OpenWizard records every step, wait, retry, and side effect. A run can stop for a crash,
        webhook, human decision, or deployment, then continue with its history intact.
      </p>

      <div className="landing-hero-actions">
        <Link to="/$" params={{ _splat: 'getting-started' }} className="landing-primary-action">
          Start building
          <ArrowRight aria-hidden="true" />
        </Link>
        <Link to="/$" params={{ _splat: 'advanced' }} className="landing-secondary-action">
          <BookOpen aria-hidden="true" />
          See the guarantees
        </Link>
      </div>

      <div className="landing-install" aria-label="Install OpenWizard">
        <Terminal aria-hidden="true" />
        <code>{site.installCommand}</code>
        <CopyButton
          text={site.installCommand}
          label="Copy install command"
          className="landing-install-copy"
        />
      </div>
    </div>
  )
}
