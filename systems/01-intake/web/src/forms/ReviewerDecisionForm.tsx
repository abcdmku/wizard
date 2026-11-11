import { useForm } from '@tanstack/react-form'

import { type ApplicationView, type ReviewerCommand, ReviewerCommandSchema } from '../../../shared'
import { ActionBar, Button, CheckboxField, RadioGroup, TextareaField } from '../components'
import { commandId, versionOf } from '../domain/application'
import { FormNotice, validationMessage } from './form-errors'

const requestedFieldOptions = [
  { label: 'Business profile', value: 'businessProfile' },
  { label: 'Beneficial owners', value: 'beneficialOwners' },
  { label: 'Standard financials', value: 'standardFinancials' },
  { label: 'Hardship evidence', value: 'hardshipEvidence' },
  { label: 'Appeal', value: 'appeal' },
  { label: 'Documents', value: 'documents' },
] as const

export interface ReviewerDecisionFormProps {
  application: ApplicationView
  onSubmit: (command: ReviewerCommand) => Promise<void>
  submitError?: string
}

function initialDecision(application: ApplicationView): ReviewerCommand {
  return {
    commandId: commandId(),
    expectedVersion: versionOf(application),
    reason: '',
    requestedFields: [],
    type: 'approve',
  }
}

export function ReviewerDecisionForm({
  application,
  onSubmit,
  submitError,
}: ReviewerDecisionFormProps) {
  const form = useForm({
    defaultValues: initialDecision(application),
    validators: {
      onChange: ({ value }) =>
        value.type === 'request-changes' && value.requestedFields.length === 0
          ? { fields: { requestedFields: 'Choose at least one section to change.' } }
          : undefined,
    },
    onSubmit: async ({ value }) => {
      const parsed = ReviewerCommandSchema.safeParse(value)
      if (parsed.success) await onSubmit(parsed.data)
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      noValidate
    >
      <div className="stack stack--large">
        <FormNotice error={submitError} />
        <form.Field name="type">
          {(field) => (
            <RadioGroup
              legend="Decision"
              name={field.name}
              required
              value={field.state.value}
              onChange={(event) =>
                field.handleChange(
                  event.target.value === 'reject'
                    ? 'reject'
                    : event.target.value === 'request-changes'
                      ? 'request-changes'
                      : 'approve',
                )
              }
              options={[
                { value: 'approve', label: 'Approve' },
                { value: 'reject', label: 'Reject' },
                {
                  value: 'request-changes',
                  label: 'Request changes',
                  description: 'Return selected sections to the applicant.',
                },
              ]}
              error={validationMessage(field.state.meta.errors)}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.values.type}>
          {(decision) =>
            decision === 'request-changes' ? (
              <fieldset className="field">
                <legend className="field__label">Sections that need changes</legend>
                <div className="form-grid form-grid--2">
                  <form.Field name="requestedFields">
                    {(field) => (
                      <>
                        {requestedFieldOptions.map((option) => (
                          <CheckboxField
                            key={option.value}
                            label={option.label}
                            checked={field.state.value.includes(option.value)}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...field.state.value, option.value]
                                : field.state.value.filter((value) => value !== option.value)
                              field.handleChange(next)
                            }}
                          />
                        ))}
                        {validationMessage(field.state.meta.errors) ? (
                          <p className="field__error" role="alert">
                            {validationMessage(field.state.meta.errors)}
                          </p>
                        ) : null}
                      </>
                    )}
                  </form.Field>
                </div>
              </fieldset>
            ) : null
          }
        </form.Subscribe>
        <form.Field
          name="reason"
          validators={{
            onChange: ({ value }) =>
              value.trim().length < 3
                ? 'Enter a decision note of at least 3 characters.'
                : undefined,
          }}
        >
          {(field) => (
            <TextareaField
              label="Decision note"
              hint="Give the applicant a clear, specific explanation."
              required
              maxLength={1_000}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              error={validationMessage(field.state.meta.errors)}
            />
          )}
        </form.Field>
      </div>
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
        {([canSubmit, isSubmitting]) => (
          <ActionBar
            status="The applicant receives this decision immediately."
            primaryAction={
              <Button
                type="submit"
                loading={isSubmitting === true}
                loadingLabel="Recording decision..."
                aria-disabled={!canSubmit}
              >
                Record decision
              </Button>
            }
          />
        )}
      </form.Subscribe>
    </form>
  )
}
