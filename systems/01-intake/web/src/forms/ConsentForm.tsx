import { useForm } from '@tanstack/react-form'
import type { z } from 'zod'

import { ConsentInputSchema } from '../../../shared/forms'
import { type AsyncFormProps, CheckboxControl, FormActions, TextControl } from './form-controls'
import { FormNotice } from './form-errors'

export type ConsentFormValues = z.infer<typeof ConsentInputSchema>
export type ConsentFormProps = AsyncFormProps<ConsentFormValues>

export function ConsentForm({ initialValues, onSubmit, submitError, onBack }: ConsentFormProps) {
  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: ConsentInputSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(ConsentInputSchema.parse(value))
    },
  })

  return (
    <form
      className="stack stack--large"
      aria-label="Consent and prefill permissions"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field
        name="contactEmail"
        validators={{ onBlur: ConsentInputSchema.shape.contactEmail }}
      >
        {(field) => (
          <TextControl
            id="consent-contact-email"
            label="Contact email"
            name={field.name}
            type="email"
            autoComplete="email"
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            hint="We'll use this address for updates about this application."
            required
          />
        )}
      </form.Field>

      <form.Field name="consentToPreviousApplication">
        {(field) => (
          <CheckboxControl
            id="consent-previous-application"
            label="Use details from my previous application, if one is available."
            name={field.name}
            checked={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
          />
        )}
      </form.Field>

      <form.Field
        name="consentToRegistry"
        validators={{
          onChange: ({ value }) => (value ? undefined : 'Registry consent is required to continue'),
        }}
      >
        {(field) => (
          <CheckboxControl
            id="consent-registry"
            label="I authorize a registry lookup to prefill and verify my business details."
            name={field.name}
            checked={field.state.value}
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
