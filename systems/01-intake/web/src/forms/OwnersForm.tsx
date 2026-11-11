import { useForm } from '@tanstack/react-form'
import type { z } from 'zod'

import { BeneficialOwnersInputSchema } from '../../../shared'
import { ActionBar, Alert, Button, Card, InputField, SectionHeader } from '../components'
import { FormNotice, validationMessage } from './form-errors'

type BeneficialOwnersInput = z.infer<typeof BeneficialOwnersInputSchema>

export interface OwnersFormProps {
  initialValue?: BeneficialOwnersInput
  onBack: () => void
  onSubmit: (value: BeneficialOwnersInput) => Promise<void>
  submitError?: string
}

function newOwner() {
  return {
    dateOfBirth: undefined,
    id: globalThis.crypto.randomUUID(),
    name: '',
    ownershipPercent: 0,
  }
}

export function OwnersForm({ initialValue, onBack, onSubmit, submitError }: OwnersFormProps) {
  const form = useForm({
    defaultValues: initialValue ?? { owners: [newOwner()] },
    validators: { onChange: BeneficialOwnersInputSchema },
    onSubmit: async ({ value }) => onSubmit(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      noValidate
    >
      <SectionHeader
        as="h1"
        eyebrow="Business ownership"
        title="Tell us who owns the company"
        description="List every beneficial owner. The ownership percentages must add up to 100%."
      />
      <Alert tone="info" title="Why we ask">
        We use this information for identity and conflict checks. Applicants see only the details
        they entered.
      </Alert>
      <FormNotice error={submitError} />
      <form.Field name="owners" mode="array">
        {(ownersField) => (
          <div className="stack stack--large">
            {ownersField.state.value.map((owner, index) => (
              <Card key={owner.id}>
                <SectionHeader
                  title={`Owner ${index + 1}`}
                  action={
                    ownersField.state.value.length > 1 ? (
                      <Button
                        variant="quiet"
                        size="small"
                        onClick={() => ownersField.removeValue(index)}
                      >
                        Remove
                      </Button>
                    ) : null
                  }
                />
                <div className="form-grid form-grid--2">
                  <form.Field name={`owners[${index}].name`}>
                    {(field) => (
                      <InputField
                        label="Full legal name"
                        required
                        autoComplete="name"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value)}
                        error={validationMessage(field.state.meta.errors)}
                      />
                    )}
                  </form.Field>
                  <form.Field name={`owners[${index}].ownershipPercent`}>
                    {(field) => (
                      <InputField
                        label="Ownership"
                        hint="Enter a percentage between 0 and 100."
                        required
                        inputMode="decimal"
                        min={0.01}
                        max={100}
                        step="0.01"
                        type="number"
                        value={field.state.value || ''}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(
                            event.target.value === '' ? 0 : event.target.valueAsNumber,
                          )
                        }
                        error={validationMessage(field.state.meta.errors)}
                      />
                    )}
                  </form.Field>
                  <form.Field name={`owners[${index}].dateOfBirth`}>
                    {(field) => (
                      <InputField
                        label="Date of birth"
                        hint="Optional. Used only when a name match needs verification."
                        type="date"
                        value={field.state.value ?? ''}
                        onBlur={field.handleBlur}
                        onChange={(event) => field.handleChange(event.target.value || undefined)}
                        error={validationMessage(field.state.meta.errors)}
                      />
                    )}
                  </form.Field>
                </div>
              </Card>
            ))}
            <Button variant="secondary" onClick={() => ownersField.pushValue(newOwner())}>
              Add another owner
            </Button>
            <form.Subscribe selector={(state) => state.values.owners}>
              {(owners) => {
                const total = owners.reduce((sum, owner) => sum + owner.ownershipPercent, 0)
                return (
                  <Alert
                    tone={Math.abs(total - 100) < 0.001 ? 'success' : 'warning'}
                    title={`Total ownership: ${total.toLocaleString('en-US', {
                      maximumFractionDigits: 2,
                    })}%`}
                    aria-live="polite"
                  >
                    {Math.abs(total - 100) < 0.001
                      ? 'The ownership total is complete.'
                      : 'Adjust the percentages until the total is exactly 100%.'}
                  </Alert>
                )
              }}
            </form.Subscribe>
            {validationMessage(ownersField.state.meta.errors) ? (
              <p className="field__error" role="alert">
                {validationMessage(ownersField.state.meta.errors)}
              </p>
            ) : null}
          </div>
        )}
      </form.Field>
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
                loadingLabel="Saving owners..."
                aria-disabled={!canSubmit}
              >
                Save and continue
              </Button>
            }
          />
        )}
      </form.Subscribe>
    </form>
  )
}
