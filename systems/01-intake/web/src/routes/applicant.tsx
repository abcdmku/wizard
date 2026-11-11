import { useNavigate, useParams } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'

import {
  AppealInputSchema,
  type ApplicationView,
  BeneficialOwnersInputSchema,
  BusinessProfileInputSchema,
  DocumentsInputSchema,
  HardshipEvidenceInputSchema,
  ReviewInputSchema,
  StandardFinancialsInputSchema,
} from '../../../shared'
import { ErrorCard, errorMessage, LoadingCard } from '../app/errors'
import {
  Alert,
  Card,
  DefinitionList,
  ProgressStepper,
  ReviewSection,
  SectionHeader,
  StatusBadge,
} from '../components'
import {
  currency,
  currentApplicantStep,
  isIncorporated,
  parsedStepInput,
} from '../domain/application'
import { type ApplicantStep, isApplicantStep, progressSteps } from '../domain/steps'
import { OwnersForm } from '../forms/OwnersForm'
import { ReviewConfirmForm } from '../forms/ReviewConfirmForm'
import { useApplicationWizard } from '../hooks/use-application-wizard'
import { useApplication } from '../hooks/use-intake-api'
import { ApplicantBasicStep } from './applicant-basic'
import { ResultView, RiskView } from './applicant-outcomes'
import { EligibilityStep } from './eligibility'

export function ApplicationIndex() {
  const { applicationId } = useParams({ from: '/apply/$applicationId/' })
  const query = useApplication(applicationId)
  const navigate = useNavigate()

  useEffect(() => {
    if (!query.data) return
    void navigate({
      to: '/apply/$applicationId/$step',
      params: { applicationId, step: currentApplicantStep(query.data) },
      replace: true,
    })
  }, [applicationId, navigate, query.data])

  if (query.error) return <ErrorCard error={query.error} onRetry={() => void query.refetch()} />
  return <LoadingCard>Opening your saved application...</LoadingCard>
}

export function ApplicantStepRoute() {
  const { applicationId, step } = useParams({ from: '/apply/$applicationId/$step' })
  if (!isApplicantStep(step)) {
    return <ErrorCard error={new Error(`Unknown application step: ${step}`)} />
  }
  return <ApplicantStepPage applicationId={applicationId} step={step} />
}

function ApplicantReview({
  application,
  edit,
  onBack,
  onSubmit,
  submitError,
}: {
  application: ApplicationView
  edit: (step: 'businessProfile' | 'beneficialOwners' | 'documents') => void
  onBack: () => void
  onSubmit: (values: Readonly<Record<string, unknown>>) => Promise<void>
  submitError?: string | undefined
}) {
  const business = parsedStepInput(application, 'businessProfile', BusinessProfileInputSchema)
  const owners = parsedStepInput(application, 'beneficialOwners', BeneficialOwnersInputSchema)
  const documents = parsedStepInput(application, 'documents', DocumentsInputSchema)
  const financials = parsedStepInput(
    application,
    'standardFinancials',
    StandardFinancialsInputSchema,
  )
  const hardship = parsedStepInput(application, 'hardshipEvidence', HardshipEvidenceInputSchema)
  const appeal = parsedStepInput(application, 'appeal', AppealInputSchema)
  const review = parsedStepInput(application, 'review', ReviewInputSchema)
  const invalidated =
    application.status === 'changes-requested'
      ? (application.workflow.context.changeRequestReason ??
        'A reviewer asked you to check this section.')
      : false

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Final review"
        title="Check your answers before submitting"
        description="Editing an earlier answer can invalidate later steps. The server will reopen anything that needs another look."
      />
      <ReviewSection
        title="Business profile"
        onEdit={() => edit('businessProfile')}
        invalidated={invalidated}
      >
        <DefinitionList
          items={[
            { term: 'Legal name', detail: business?.legalName ?? 'Not provided' },
            { term: 'Structure', detail: business?.legalStructure ?? 'Not provided' },
            { term: 'Annual revenue', detail: currency(business?.annualRevenue) },
            { term: 'Grant request', detail: currency(business?.requestedAmount) },
          ]}
        />
      </ReviewSection>
      {owners ? (
        <ReviewSection title="Beneficial owners" onEdit={() => edit('beneficialOwners')}>
          <DefinitionList
            items={owners.owners.map((owner) => ({
              id: owner.id,
              term: owner.name,
              detail: `${owner.ownershipPercent}% ownership`,
            }))}
          />
        </ReviewSection>
      ) : null}
      <ReviewSection title="Eligibility details">
        <DefinitionList
          items={[
            { term: 'Path', detail: application.workflow.context.eligibilityPath ?? 'Pending' },
            {
              term: 'Evidence',
              detail: financials
                ? `${currency(financials.cashOnHand)} cash on hand`
                : (hardship?.evidenceReference ?? appeal?.appealReason ?? 'Not provided'),
            },
          ]}
        />
      </ReviewSection>
      <ReviewSection title="Documents" onEdit={() => edit('documents')}>
        <p>{documents ? `${documents.documents.length} document records added` : 'None added'}</p>
      </ReviewSection>
      <ReviewConfirmForm
        onBack={onBack}
        onSubmit={onSubmit}
        {...(review ? { initialValue: review } : {})}
        {...(submitError ? { submitError } : {})}
      />
    </>
  )
}

function ApplicantStepPage({
  applicationId,
  step,
}: {
  applicationId: string
  step: ApplicantStep
}) {
  const wizard = useApplicationWizard(applicationId)
  const application = wizard.applicationQuery.data

  useEffect(() => {
    if (!application) return
    const current = currentApplicantStep(application)
    if (current !== step) void wizard.navigateTo(current, true)
  }, [application, wizard, step])

  if (wizard.applicationQuery.isPending) return <LoadingCard />
  if (wizard.applicationQuery.error) {
    return (
      <ErrorCard
        error={wizard.applicationQuery.error}
        onRetry={() => void wizard.applicationQuery.refetch()}
      />
    )
  }
  if (!application) return <ErrorCard error={new Error('Application not found.')} />

  const current = currentApplicantStep(application)
  if (current !== step) return <LoadingCard>Opening the current step...</LoadingCard>
  const submitError = wizard.command.error ? errorMessage(wizard.command.error) : undefined
  const save = wizard.saveAndContinue
  let content: ReactNode

  if (step === 'consent' || step === 'business' || step === 'documents') {
    content = (
      <ApplicantBasicStep
        application={application}
        step={step}
        onBack={wizard.goBack}
        onSave={save}
        {...(submitError ? { submitError } : {})}
      />
    )
  } else if (step === 'owners') {
    const ownersInput = parsedStepInput(
      application,
      'beneficialOwners',
      BeneficialOwnersInputSchema,
    )
    content = (
      <OwnersForm
        onBack={wizard.goBack}
        onSubmit={(values) => save('beneficialOwners', values)}
        {...(ownersInput ? { initialValue: ownersInput } : {})}
        {...(submitError ? { submitError } : {})}
      />
    )
  } else if (step === 'eligibility') {
    content = (
      <EligibilityStep
        application={application}
        onBack={wizard.goBack}
        onSave={save}
        {...(submitError ? { submitError } : {})}
      />
    )
  } else if (step === 'review') {
    content = (
      <ApplicantReview
        application={application}
        edit={(target) => void wizard.edit(target)}
        onBack={wizard.goBack}
        onSubmit={(values) => save('review', values)}
        submitError={submitError}
      />
    )
  } else if (step === 'risk') {
    content = (
      <RiskView
        application={application}
        streamError={wizard.stream.error}
        streamStatus={wizard.stream.status}
      />
    )
  } else {
    content = <ResultView application={application} />
  }

  return (
    <div className="portal-page">
      {step === 'risk' || step === 'result' ? null : (
        <ProgressStepper steps={progressSteps(isIncorporated(application))} currentStep={step} />
      )}
      <div className="cluster">
        <span className="muted">Application {application.id}</span>
        <StatusBadge status={application.status} />
      </div>
      {application.workflow.context.changeRequestReason && step !== 'risk' && step !== 'result' ? (
        <Alert tone="warning" title="A reviewer requested changes">
          {application.workflow.context.changeRequestReason}
        </Alert>
      ) : null}
      {step === 'risk' || step === 'result' ? content : <Card>{content}</Card>}
    </div>
  )
}
