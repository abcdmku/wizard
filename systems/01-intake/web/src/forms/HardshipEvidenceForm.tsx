import { useForm } from '@tanstack/react-form'
import type { z } from 'zod'

import { HardshipEvidenceInputSchema } from '../../../shared/forms'
import { type AsyncFormProps, FormActions, TextAreaControl, TextControl } from './form-controls'
import { FormNotice } from './form-errors'

export type HardshipEvidenceFormValues = z.infer<typeof HardshipEvidenceInputSchema>
export type HardshipEvidenceFormProps = AsyncFormProps<HardshipEvidenceFormValues>

export function HardshipEvidenceForm({
  initialValues,
  onSubmit,
  submitError,
  onBack,
}: HardshipEvidenceFormProps) {
  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: HardshipEvidenceInputSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(HardshipEvidenceInputSchema.parse(value))
    },
  })

  return (
    <form
      className="stack stack--large"
      aria-label="Hardship evidence"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field
        name="impactSummary"
        validators={{ onBlur: HardshipEvidenceInputSchema.shape.impactSummary }}
      >
        {(field) => (
          <TextAreaControl
            id="hardship-impact-summary"
            label="How did the hardship affect your business?"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            hint="Include dates and measurable effects. Use 30 to 2,000 characters."
            maxLength={2_000}
            required
          />
        )}
      </form.Field>

      <form.Field
        name="recoveryPlan"
        validators={{ onBlur: HardshipEvidenceInputSchema.shape.recoveryPlan }}
      >
        {(field) => (
          <TextAreaControl
            id="hardship-recovery-plan"
            label="What is your recovery plan?"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            hint="Explain how the grant would support the plan. Use 30 to 2,000 characters."
            maxLength={2_000}
            required
          />
        )}
      </form.Field>

      <form.Field
        name="evidenceReference"
        validators={{ onBlur: HardshipEvidenceInputSchema.shape.evidenceReference }}
      >
        {(field) => (
          <TextControl
            id="hardship-evidence-reference"
            label="Evidence reference"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            hint="Name the statement, notice, or other document that supports your claim."
            maxLength={200}
            required
          />
        )}
      </form.Field>

      {submitError ? <FormNotice error={submitError} /> : null}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <FormActions canSubmit={canSubmit} isSubmitting={isSubmitting} onBack={onBack} />
        )}
      </form.Subscribe>
    </form>
  )
}
