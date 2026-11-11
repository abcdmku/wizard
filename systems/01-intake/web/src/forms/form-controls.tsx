import { ActionBar, Button } from '../components'

export interface AsyncFormProps<T> {
  initialValues: T
  onSubmit: (values: T) => Promise<void>
  submitError?: string
  onBack?: () => void
}

export function FormActions({
  canSubmit,
  isSubmitting,
  onBack,
  submitLabel = 'Continue',
}: {
  canSubmit: boolean
  isSubmitting: boolean
  onBack: (() => void) | undefined
  submitLabel?: string
}) {
  return (
    <ActionBar
      secondaryActions={
        onBack ? (
          <Button type="button" variant="secondary" onClick={onBack}>
            Back
          </Button>
        ) : undefined
      }
      primaryAction={
        <Button type="submit" disabled={!canSubmit} loading={isSubmitting} loadingLabel="Saving...">
          {submitLabel}
        </Button>
      }
    />
  )
}

export type { RadioOption } from './choice-controls'
export { CheckboxControl, RadioGroup } from './choice-controls'
export type { SelectOption } from './input-controls'
export { NumberControl, SelectControl, TextAreaControl, TextControl } from './input-controls'
