import { useForm } from '@tanstack/react-form'
import type { z } from 'zod'

import { ReviewInputSchema } from '../../../shared'
import { ActionBar, Button, CheckboxField, InputField } from '../components'
import { FormNotice, validationMessage } from './form-errors'

type ReviewInput = z.infer<typeof ReviewInputSchema>

export interface ReviewConfirmFormProps {
  initialValue?: ReviewInput
  onBack: () => void
  onSubmit: (value: ReviewInput) => Promise<void>
  submitError?: string
}

export function ReviewConfirmForm({
  initialValue,
  onBack,
  onSubmit,
  submitError,
}: ReviewConfirmFormProps) {
  const form = useForm({
    defaultValues: initialValue ?? { confirmed: false, signatureName: '' },
    validators: { onSubmit: ReviewInputSchema },
    onSubmit: async ({ value }) => {
      const parsed = ReviewInputSchema.safeParse(value)
      if (parsed.success) await onSubmit(parsed.data)
    },
  })

  return (
    <form
      className="stack stack--large"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field
        name="confirmed"
        validators={{
          onChange: ({ value }) =>
            value ? undefined : 'Confirm that the application is accurate.',
        }}
      >
        {(field) => (
          <CheckboxField
            label="I confirm that the information in this application is complete and accurate."
            required
            checked={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.checked)}
            error={validationMessage(field.state.meta.errors)}
          />
        )}
      </form.Field>
      <form.Field name="signatureName">
        {(field) => (
          <InputField
            label="Type your full name"
            hint="This acts as your electronic signature."
            required
            autoComplete="name"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={(event) => field.handleChange(event.target.value)}
            error={validationMessage(field.state.meta.errors)}
          />
        )}
      </form.Field>
      <FormNotice error={submitError} />
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <ActionBar
            sticky
            secondaryActions={
              <Button variant="secondary" onClick={onBack}>
                Back
              </Button>
            }
            primaryAction={
              <Button
                type="submit"
                loading={isSubmitting === true}
                loadingLabel="Submitting application..."
                aria-disabled={!canSubmit}
              >
                Submit application
              </Button>
            }
          />
        )}
      </form.Subscribe>
    </form>
  )
}
