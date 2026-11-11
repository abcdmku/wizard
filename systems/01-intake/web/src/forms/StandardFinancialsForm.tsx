import { useForm } from '@tanstack/react-form'
import type { z } from 'zod'

import { StandardFinancialsInputSchema } from '../../../shared/forms'
import { type AsyncFormProps, FormActions, NumberControl, TextControl } from './form-controls'
import { FormNotice } from './form-errors'

export type StandardFinancialsFormValues = z.infer<typeof StandardFinancialsInputSchema>
export type StandardFinancialsFormProps = AsyncFormProps<StandardFinancialsFormValues>

export function StandardFinancialsForm({
  initialValues,
  onSubmit,
  submitError,
  onBack,
}: StandardFinancialsFormProps) {
  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: StandardFinancialsInputSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(StandardFinancialsInputSchema.parse(value))
    },
  })

  return (
    <form
      className="stack stack--large"
      aria-label="Standard financial details"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <div className="form-grid form-grid--2">
        <form.Field
          name="annualExpenses"
          validators={{ onBlur: StandardFinancialsInputSchema.shape.annualExpenses }}
        >
          {(field) => (
            <NumberControl
              id="financials-annual-expenses"
              label="Annual expenses"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={field.state.meta.errors}
              hint="Enter an amount in US dollars."
              min={0}
              max={100_000_000}
              step={1}
              required
            />
          )}
        </form.Field>

        <form.Field
          name="cashOnHand"
          validators={{ onBlur: StandardFinancialsInputSchema.shape.cashOnHand }}
        >
          {(field) => (
            <NumberControl
              id="financials-cash-on-hand"
              label="Cash on hand"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={field.state.meta.errors}
              hint="Enter an amount in US dollars."
              min={0}
              max={100_000_000}
              step={1}
              required
            />
          )}
        </form.Field>
      </div>

      <form.Field
        name="fiscalYearEnd"
        validators={{ onBlur: StandardFinancialsInputSchema.shape.fiscalYearEnd }}
      >
        {(field) => (
          <TextControl
            id="financials-fiscal-year-end"
            label="Fiscal year end"
            name={field.name}
            type="date"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
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
