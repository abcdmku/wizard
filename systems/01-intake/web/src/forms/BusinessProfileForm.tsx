import { useForm } from '@tanstack/react-form'
import type { z } from 'zod'

import { BusinessProfileInputSchema } from '../../../shared/forms'
import {
  type AsyncFormProps,
  CheckboxControl,
  FormActions,
  NumberControl,
  RadioGroup,
  type RadioOption,
  TextControl,
} from './form-controls'
import { FormNotice } from './form-errors'

export type BusinessProfileFormValues = z.infer<typeof BusinessProfileInputSchema>
export type BusinessProfileFormProps = AsyncFormProps<BusinessProfileFormValues>

const legalStructureOptions: readonly RadioOption<BusinessProfileFormValues['legalStructure']>[] = [
  { value: 'sole-proprietor', label: 'Sole proprietor' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'incorporated', label: 'Incorporated business' },
  { value: 'nonprofit', label: 'Nonprofit' },
]

export function BusinessProfileForm({
  initialValues,
  onSubmit,
  submitError,
  onBack,
}: BusinessProfileFormProps) {
  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: BusinessProfileInputSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(BusinessProfileInputSchema.parse(value))
    },
  })

  return (
    <form
      className="stack stack--large"
      aria-label="Business profile"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field
        name="legalName"
        validators={{ onBlur: BusinessProfileInputSchema.shape.legalName }}
      >
        {(field) => (
          <TextControl
            id="business-legal-name"
            label="Legal business name"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            autoComplete="organization"
            maxLength={160}
            required
          />
        )}
      </form.Field>

      <form.Field
        name="legalStructure"
        validators={{ onBlur: BusinessProfileInputSchema.shape.legalStructure }}
      >
        {(field) => (
          <RadioGroup
            id="business-legal-structure"
            label="Legal structure"
            name={field.name}
            value={field.state.value}
            options={legalStructureOptions}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            required
          />
        )}
      </form.Field>

      <form.Field
        name="registrationNumber"
        validators={{ onBlur: BusinessProfileInputSchema.shape.registrationNumber }}
      >
        {(field) => (
          <TextControl
            id="business-registration-number"
            label="Registration number"
            name={field.name}
            value={field.state.value ?? ''}
            onBlur={field.handleBlur}
            onChange={(value) => field.handleChange(value.length === 0 ? undefined : value)}
            errors={field.state.meta.errors}
            hint="Required for incorporated businesses."
            maxLength={64}
          />
        )}
      </form.Field>

      <div className="form-grid form-grid--2">
        <form.Field
          name="annualRevenue"
          validators={{ onBlur: BusinessProfileInputSchema.shape.annualRevenue }}
        >
          {(field) => (
            <NumberControl
              id="business-annual-revenue"
              label="Annual revenue"
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
          name="requestedAmount"
          validators={{ onBlur: BusinessProfileInputSchema.shape.requestedAmount }}
        >
          {(field) => (
            <NumberControl
              id="business-requested-amount"
              label="Requested grant amount"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={field.state.meta.errors}
              hint="Enter an amount in US dollars."
              min={1}
              max={2_000_000}
              step={1}
              required
            />
          )}
        </form.Field>

        <form.Field
          name="tradingMonths"
          validators={{ onBlur: BusinessProfileInputSchema.shape.tradingMonths }}
        >
          {(field) => (
            <NumberControl
              id="business-trading-months"
              label="Months in operation"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={field.state.meta.errors}
              min={0}
              max={1_200}
              step={1}
              required
            />
          )}
        </form.Field>

        <form.Field
          name="employeeCount"
          validators={{ onBlur: BusinessProfileInputSchema.shape.employeeCount }}
        >
          {(field) => (
            <NumberControl
              id="business-employee-count"
              label="Number of employees"
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              errors={field.state.meta.errors}
              min={0}
              max={10_000}
              step={1}
              required
            />
          )}
        </form.Field>
      </div>

      <form.Field
        name="postalCode"
        validators={{ onBlur: BusinessProfileInputSchema.shape.postalCode }}
      >
        {(field) => (
          <TextControl
            id="business-postal-code"
            label="Business postal code"
            name={field.name}
            value={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
            autoComplete="postal-code"
            maxLength={16}
            required
          />
        )}
      </form.Field>

      <form.Field name="experiencedHardship">
        {(field) => (
          <CheckboxControl
            id="business-experienced-hardship"
            label="This business experienced a qualifying financial hardship."
            name={field.name}
            checked={field.state.value}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            errors={field.state.meta.errors}
          />
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.experiencedHardship}>
        {(experiencedHardship) =>
          experiencedHardship ? (
            <form.Field
              name="revenueDropPercent"
              validators={{ onBlur: BusinessProfileInputSchema.shape.revenueDropPercent }}
            >
              {(field) => (
                <NumberControl
                  id="business-revenue-drop"
                  label="Revenue drop"
                  name={field.name}
                  value={field.state.value ?? Number.NaN}
                  onBlur={field.handleBlur}
                  onChange={(value) => field.handleChange(Number.isNaN(value) ? undefined : value)}
                  errors={field.state.meta.errors}
                  hint="Enter the percentage decrease caused by the hardship."
                  min={0}
                  max={100}
                  step={0.1}
                  required
                />
              )}
            </form.Field>
          ) : null
        }
      </form.Subscribe>

      {submitError ? <FormNotice error={submitError} /> : null}
      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <FormActions canSubmit={canSubmit} isSubmitting={isSubmitting} onBack={onBack} />
        )}
      </form.Subscribe>
    </form>
  )
}
