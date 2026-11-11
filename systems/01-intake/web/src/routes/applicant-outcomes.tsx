import { Link } from '@tanstack/react-router'

import type { ApplicationView } from '../../../shared'
import type { EventStreamStatus } from '../api/events'
import {
  Alert,
  Card,
  DefinitionList,
  RiskProgress,
  SectionHeader,
  StatusBadge,
} from '../components'
import { currency, shortDate } from '../domain/application'

export function RiskView({
  application,
  streamError,
  streamStatus,
}: {
  application: ApplicationView
  streamError?: Error | undefined
  streamStatus: EventStreamStatus
}) {
  const outcome = application.workflow.context.riskOutcome
  const manualReview = outcome === 'manual-review' || application.status === 'awaiting-reviewer'

  return (
    <div className="stack stack--large">
      <SectionHeader
        as="h1"
        eyebrow="Submitted"
        title={manualReview ? 'Your application is with a reviewer' : 'Screening your application'}
        description={
          manualReview
            ? 'No action is needed unless the reviewer asks for a change.'
            : 'You can leave this page. We save the result and show it when you return.'
        }
        action={<StatusBadge status={application.status} />}
      />
      <Card tone="accent">
        <RiskProgress
          status={outcome ?? application.status}
          message={
            manualReview
              ? 'Automated screening sent this application to a grant reviewer.'
              : 'Registry, eligibility, and document checks are running.'
          }
        />
      </Card>
      <Alert
        tone={streamStatus === 'open' ? 'success' : 'info'}
        title={streamStatus === 'open' ? 'Live updates connected' : 'Reconnecting to live updates'}
      >
        The application record remains the source of truth if this connection drops.
      </Alert>
      {streamError ? (
        <Alert tone="warning" title="Live updates paused">
          Refreshing this page will load the latest saved result.
        </Alert>
      ) : null}
    </div>
  )
}

export function ResultView({ application }: { application: ApplicationView }) {
  const approved = application.status === 'approved'
  const failed = application.status === 'failed'
  const heading = approved
    ? 'Your grant was approved'
    : failed
      ? 'We could not finish this application'
      : 'Your application was not approved'

  return (
    <div className="stack stack--large">
      <SectionHeader
        as="h1"
        eyebrow="Application decision"
        title={heading}
        action={<StatusBadge status={application.status} />}
      />
      <Card tone={approved ? 'accent' : 'default'}>
        <p>
          {approved
            ? 'The grant team will contact you with the payment and agreement details.'
            : failed
              ? 'Your saved answers are still available. Contact the grant team before starting again.'
              : 'The application record remains available for your files.'}
        </p>
        <DefinitionList
          columns={1}
          items={[
            { term: 'Application ID', detail: application.id },
            {
              term: 'Requested amount',
              detail: currency(application.workflow.context.requestedAmount),
            },
            { term: 'Last updated', detail: shortDate(application.updatedAt) },
          ]}
        />
      </Card>
      <div className="cluster">
        <Link className="button button--secondary" to="/">
          Return to demo accounts
        </Link>
      </div>
    </div>
  )
}
