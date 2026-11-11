import { useForm } from '@tanstack/react-form'
import type { z } from 'zod'

import { AppealInputSchema } from '../../../shared/forms'
import { type AsyncFormProps, FormActions, TextAreaControl } from './form-controls'
import { FormNotice } from './form-errors'

export type AppealFormValues = z.infer<typeof AppealInputSchema>
export type AppealFormProps = AsyncFormProps<AppealFormValues>

export function AppealForm({ initialValues, onSubmit, submitError, onBack }: AppealFormProps) {
  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: AppealInputSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(AppealInputSchema.parse(value))
    },
  })

  return (
    <form
      className="stack stack--large"
      aria-label="Eligibility appeal"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field name="appealReason" validators={{ onBlur: AppealInputSchema.shape.appealReason }}>
        {(field) => (
          <TextAreaControl
            id="appeal-reason"
            label="Why should we reconsider your eligibility?"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            hint="Explain what you believe should be reconsidered. Use 30 to 2,000 characters."
            maxLength={2_000}
            required
          />
        )}
      </form.Field>

      <form.Field
        name="supportingFacts"
        validators={{ onBlur: AppealInputSchema.shape.supportingFacts }}
      >
        {(field) => (
          <TextAreaControl
            id="appeal-supporting-facts"
            label="Supporting facts"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            hint="Include dates, amounts, and records we can verify. Use 30 to 2,000 characters."
            maxLength={2_000}
            required
          />
        )}
      </form.Field>

      {submitError ? <FormNotice error={submitError} /> : null}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <FormActions
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            onBack={onBack}
            submitLabel="Submit appeal"
          />
        )}
      </form.Subscribe>
    </form>
  )
}
