import {
  type ApplicationView,
  BusinessProfileInputSchema,
  ConsentInputSchema,
  DocumentsInputSchema,
  type IntakeViewStepId,
  LegalStructureSchema,
} from '../../../shared'
import { Alert, RiskProgress, SectionHeader } from '../components'
import { parsedStepInput } from '../domain/application'
import type { ApplicantStep } from '../domain/steps'
import { BusinessProfileForm } from '../forms/BusinessProfileForm'
import { ConsentForm } from '../forms/ConsentForm'
import { DocumentsForm } from '../forms/DocumentsForm'

export interface ApplicantBasicStepProps {
  application: ApplicationView
  onBack: () => void
  onSave: (step: IntakeViewStepId, values: Readonly<Record<string, unknown>>) => Promise<void>
  step: Extract<ApplicantStep, 'business' | 'consent' | 'documents'>
  submitError?: string
}

export function ApplicantBasicStep({
  application,
  onBack,
  onSave,
  step,
  submitError,
}: ApplicantBasicStepProps) {
  if (step === 'consent') {
    const slug = application.applicantName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
    return (
      <>
        <SectionHeader
          as="h1"
          eyebrow="Before you begin"
          title="Choose what we can prefill"
          description="Registry access is required for this program. Reusing a previous application is optional."
        />
        <ConsentForm
          initialValues={
            parsedStepInput(application, 'consent', ConsentInputSchema) ?? {
              consentToPreviousApplication: false,
              consentToRegistry: false,
              contactEmail: `${slug || 'applicant'}@example.test`,
            }
          }
          onBack={onBack}
          onSubmit={(values) => onSave('consent', values)}
          {...(submitError ? { submitError } : {})}
        />
      </>
    )
  }

  if (step === 'business') {
    if (application.workflow.current === 'prefill') {
      return (
        <div className="stack stack--large">
          <SectionHeader
            as="h1"
            eyebrow="Business lookup"
            title="Prefilling your business profile"
            description="We are checking the registry and any previous demo application you allowed us to use."
          />
          <RiskProgress status="running" message="Looking up business details..." />
          <Alert tone="info" title="Keep this page open for live updates">
            Your application is saved. It is safe to return later.
          </Alert>
        </div>
      )
    }
    const legalStructure = LegalStructureSchema.safeParse(
      application.workflow.context.legalStructure,
    )
    return (
      <>
        <SectionHeader
          as="h1"
          eyebrow="Business profile"
          title="Check the business details"
          description="Correct any prefilled details, then add the figures used for eligibility."
        />
        <BusinessProfileForm
          initialValues={
            parsedStepInput(application, 'businessProfile', BusinessProfileInputSchema) ?? {
              annualRevenue: 0,
              employeeCount: 0,
              experiencedHardship: false,
              legalName: application.workflow.context.legalName ?? '',
              legalStructure: legalStructure.success ? legalStructure.data : 'sole-proprietor',
              postalCode: '',
              requestedAmount: 0,
              tradingMonths: 0,
            }
          }
          onBack={onBack}
          onSubmit={(values) => onSave('businessProfile', values)}
          {...(submitError ? { submitError } : {})}
        />
      </>
    )
  }

  return (
    <>
      <SectionHeader
        as="h1"
        eyebrow="Supporting records"
        title="Add document metadata"
        description="This demo records file names, categories, sizes, and timestamps. File contents are not uploaded."
      />
      <DocumentsForm
        initialValues={
          parsedStepInput(application, 'documents', DocumentsInputSchema) ?? { documents: [] }
        }
        onBack={onBack}
        onSubmit={(values) => onSave('documents', values)}
        {...(submitError ? { submitError } : {})}
      />
    </>
  )
}
