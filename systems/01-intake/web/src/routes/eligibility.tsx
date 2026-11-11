import type { ApplicationView, IntakeViewStepId } from '../../../shared'
import {
  AppealInputSchema,
  HardshipEvidenceInputSchema,
  StandardFinancialsInputSchema,
} from '../../../shared'
import { Alert, RiskProgress, SectionHeader } from '../components'
import { parsedStepInput } from '../domain/application'
import { AppealForm } from '../forms/AppealForm'
import { HardshipEvidenceForm } from '../forms/HardshipEvidenceForm'
import { StandardFinancialsForm } from '../forms/StandardFinancialsForm'

export interface EligibilityStepProps {
  application: ApplicationView
  onBack: () => void
  onSave: (step: IntakeViewStepId, values: Readonly<Record<string, unknown>>) => Promise<void>
  submitError?: string
}

export function EligibilityStep({
  application,
  onBack,
  onSave,
  submitError,
}: EligibilityStepProps) {
  const current = application.workflow.current

  if (current === 'standardFinancials' || application.status === 'standard-financials') {
    return (
      <>
        <SectionHeader
          as="h1"
          eyebrow="Standard eligibility path"
          title="Add your latest financials"
          description="These figures help us compare the request with the business's current position."
        />
        <StandardFinancialsForm
          initialValues={
            parsedStepInput(application, 'standardFinancials', StandardFinancialsInputSchema) ?? {
              annualExpenses: 0,
              cashOnHand: 0,
              fiscalYearEnd: '',
            }
          }
          onBack={onBack}
          onSubmit={(values) => onSave('standardFinancials', values)}
          {...(submitError ? { submitError } : {})}
        />
      </>
    )
  }

  if (current === 'hardshipEvidence' || application.status === 'hardship-evidence') {
    return (
      <>
        <SectionHeader
          as="h1"
          eyebrow="Hardship path"
          title="Explain the business hardship"
          description="Describe the impact, recovery plan, and the document that supports this request."
        />
        <HardshipEvidenceForm
          initialValues={
            parsedStepInput(application, 'hardshipEvidence', HardshipEvidenceInputSchema) ?? {
              evidenceReference: '',
              impactSummary: '',
              recoveryPlan: '',
            }
          }
          onBack={onBack}
          onSubmit={(values) => onSave('hardshipEvidence', values)}
          {...(submitError ? { submitError } : {})}
        />
      </>
    )
  }

  if (current === 'appeal' || application.status === 'appeal') {
    return (
      <>
        <SectionHeader
          as="h1"
          eyebrow="Appeal path"
          title="Tell us why this request should be reconsidered"
          description="Give concrete facts that address the eligibility result. A reviewer will see this explanation."
        />
        <AppealForm
          initialValues={
            parsedStepInput(application, 'appeal', AppealInputSchema) ?? {
              appealReason: '',
              supportingFacts: '',
            }
          }
          onBack={onBack}
          onSubmit={(values) => onSave('appeal', values)}
          {...(submitError ? { submitError } : {})}
        />
      </>
    )
  }

  return (
    <div className="stack stack--large">
      <SectionHeader
        as="h1"
        eyebrow="Eligibility"
        title="Checking the right application path"
        description="This usually takes only a few seconds. You can leave this page and return later."
      />
      <RiskProgress status="eligibility-pending" message="Checking the business profile..." />
      <Alert tone="info" title="No action needed">
        The result will open the standard, hardship, or appeal form automatically.
      </Alert>
    </div>
  )
}
