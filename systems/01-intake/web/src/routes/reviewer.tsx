import { Link, useNavigate, useParams } from '@tanstack/react-router'

import {
  AppealInputSchema,
  type ApplicationView,
  BeneficialOwnersInputSchema,
  BusinessProfileInputSchema,
  DocumentsInputSchema,
  HardshipEvidenceInputSchema,
  StandardFinancialsInputSchema,
} from '../../../shared'
import { ErrorCard, errorMessage, LoadingCard } from '../app/errors'
import {
  Alert,
  Card,
  DefinitionList,
  ReviewerQueue,
  ReviewSection,
  RiskProgress,
  SectionHeader,
  StatusBadge,
} from '../components'
import { currency, parsedStepInput, shortDate } from '../domain/application'
import { ReviewerDecisionForm } from '../forms/ReviewerDecisionForm'
import {
  useReviewerApplication,
  useReviewerCommand,
  useReviewerQueue,
} from '../hooks/use-intake-api'

export function ReviewerQueuePage() {
  const navigate = useNavigate()
  const queue = useReviewerQueue()

  if (queue.isPending) return <LoadingCard>Loading the reviewer queue...</LoadingCard>
  if (queue.error) return <ErrorCard error={queue.error} onRetry={() => void queue.refetch()} />

  const items = (queue.data?.applications ?? []).map((application) => ({
    amount: currency(application.requestedAmount),
    applicantName: application.applicantName,
    id: application.id,
    program: 'Recovery grant',
    status: application.status,
    submittedAt: shortDate(application.updatedAt),
    ...(application.riskOutcome ? { risk: application.riskOutcome } : {}),
  }))

  return (
    <div className="portal-page">
      <SectionHeader
        as="h1"
        eyebrow="Reviewer workspace"
        title="Applications"
        description="Open a projected application to review its evidence and record a decision. Private consent details and internal risk inputs stay out of this view."
        action={
          <Link className="button button--secondary" to="/">
            Demo accounts
          </Link>
        }
      />
      <ReviewerQueue
        items={items}
        onSelect={(item) => {
          void navigate({
            to: '/reviewer/$applicationId',
            params: { applicationId: item.id },
          })
        }}
      />
    </div>
  )
}

function ApplicationSummary({ application }: { application: ApplicationView }) {
  const business = parsedStepInput(application, 'businessProfile', BusinessProfileInputSchema)
  const owners = parsedStepInput(application, 'beneficialOwners', BeneficialOwnersInputSchema)
  const financials = parsedStepInput(
    application,
    'standardFinancials',
    StandardFinancialsInputSchema,
  )
  const hardship = parsedStepInput(application, 'hardshipEvidence', HardshipEvidenceInputSchema)
  const appeal = parsedStepInput(application, 'appeal', AppealInputSchema)
  const documents = parsedStepInput(application, 'documents', DocumentsInputSchema)

  return (
    <Card>
      <ReviewSection title="Business profile">
        <DefinitionList
          items={[
            {
              term: 'Legal name',
              detail:
                business?.legalName ?? application.workflow.context.legalName ?? 'Not provided',
            },
            {
              term: 'Structure',
              detail:
                business?.legalStructure ??
                application.workflow.context.legalStructure ??
                'Not provided',
            },
            { term: 'Registration', detail: business?.registrationNumber ?? 'Not provided' },
            { term: 'Annual revenue', detail: currency(business?.annualRevenue) },
            {
              term: 'Requested amount',
              detail: currency(
                business?.requestedAmount ?? application.workflow.context.requestedAmount,
              ),
            },
            {
              term: 'Trading history',
              detail: business ? `${business.tradingMonths} months` : 'Not provided',
            },
          ]}
        />
      </ReviewSection>
      {owners ? (
        <ReviewSection title="Beneficial owners">
          <DefinitionList
            items={owners.owners.map((owner) => ({
              id: owner.id,
              term: owner.name,
              detail: `${owner.ownershipPercent}% ownership`,
            }))}
          />
        </ReviewSection>
      ) : null}
      {financials ? (
        <ReviewSection title="Standard financials">
          <DefinitionList
            items={[
              { term: 'Annual expenses', detail: currency(financials.annualExpenses) },
              { term: 'Cash on hand', detail: currency(financials.cashOnHand) },
              { term: 'Fiscal year end', detail: shortDate(financials.fiscalYearEnd) },
            ]}
          />
        </ReviewSection>
      ) : null}
      {hardship ? (
        <ReviewSection title="Hardship evidence">
          <p>{hardship.impactSummary}</p>
          <p>
            <strong>Recovery plan:</strong> {hardship.recoveryPlan}
          </p>
          <p>
            <strong>Evidence reference:</strong> {hardship.evidenceReference}
          </p>
        </ReviewSection>
      ) : null}
      {appeal ? (
        <ReviewSection title="Appeal">
          <p>{appeal.appealReason}</p>
          <p>
            <strong>Supporting facts:</strong> {appeal.supportingFacts}
          </p>
        </ReviewSection>
      ) : null}
      <ReviewSection title="Documents">
        {documents ? (
          <ul className="stack">
            {documents.documents.map((document) => (
              <li key={document.id}>
                <strong>{document.name}</strong>, {document.category}, uploaded{' '}
                {shortDate(document.uploadedAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p>No projected document metadata is available.</p>
        )}
      </ReviewSection>
    </Card>
  )
}

export function ReviewerApplicationPage() {
  const { applicationId } = useParams({ from: '/reviewer/$applicationId' })
  const applicationQuery = useReviewerApplication(applicationId)
  const decision = useReviewerCommand(applicationId)

  if (applicationQuery.isPending) return <LoadingCard>Loading the application...</LoadingCard>
  if (applicationQuery.error) {
    return (
      <ErrorCard error={applicationQuery.error} onRetry={() => void applicationQuery.refetch()} />
    )
  }
  const application = applicationQuery.data
  if (!application) return <ErrorCard error={new Error('Application not found.')} />
  const terminal = ['approved', 'rejected', 'cancelled'].includes(application.status)
  const canDecide = application.status === 'awaiting-reviewer'

  return (
    <div className="portal-page">
      <SectionHeader
        as="h1"
        eyebrow="Application review"
        title={application.workflow.context.legalName ?? application.applicantName}
        description={`Application ${application.id}`}
        action={<StatusBadge status={application.status} />}
      />
      <Link className="button button--quiet" to="/reviewer">
        Back to queue
      </Link>
      {application.workflow.context.changeRequestReason ? (
        <Alert tone="warning" title="Changes were requested">
          {application.workflow.context.changeRequestReason}
        </Alert>
      ) : null}
      <div className="page-grid">
        <ApplicationSummary application={application} />
        <div className="stack stack--large">
          <Card>
            <SectionHeader title="Risk result" />
            <RiskProgress
              status={application.workflow.context.riskOutcome ?? application.status}
              message="This view shows the outcome only. Internal scores and screening inputs are not exposed."
            />
          </Card>
          <Card>
            <SectionHeader
              title={
                terminal
                  ? 'Decision recorded'
                  : canDecide
                    ? 'Record a decision'
                    : 'Decision unavailable'
              }
              description={
                terminal
                  ? 'This application is closed.'
                  : canDecide
                    ? 'The applicant receives your note.'
                    : 'The workflow must finish screening before a reviewer can decide.'
              }
            />
            {canDecide ? (
              <ReviewerDecisionForm
                application={application}
                onSubmit={async (command) => {
                  await decision.mutateAsync(command)
                }}
                {...(decision.error ? { submitError: errorMessage(decision.error) } : {})}
              />
            ) : (
              <StatusBadge status={application.status} />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
