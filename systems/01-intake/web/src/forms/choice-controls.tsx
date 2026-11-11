import { CheckboxField, RadioGroup as UiRadioGroup } from '../components'
import { validationMessage } from './form-errors'

interface FieldChoiceProps {
  id: string
  label: string
  name: string
  errors: readonly unknown[]
  hint?: string
  required?: boolean
}

interface CheckboxControlProps extends FieldChoiceProps {
  checked: boolean
  onBlur: () => void
  onChange: (checked: boolean) => void
}

export function CheckboxControl({
  id,
  label,
  name,
  checked,
  onBlur,
  onChange,
  errors,
  hint,
  required = false,
}: CheckboxControlProps) {
  return (
    <CheckboxField
      id={id}
      label={label}
      name={name}
      checked={checked}
      onBlur={onBlur}
      onChange={(event) => onChange(event.currentTarget.checked)}
      description={hint}
      error={validationMessage(errors)}
      required={required}
    />
  )
}

export interface RadioOption<T extends string> {
  label: string
  value: T
}

interface RadioGroupProps<T extends string> extends FieldChoiceProps {
  value: T
  options: readonly RadioOption<T>[]
  onBlur: () => void
  onChange: (value: T) => void
}

export function RadioGroup<T extends string>({
  label,
  name,
  value,
  options,
  onBlur,
  onChange,
  errors,
  hint,
  required = false,
}: RadioGroupProps<T>) {
  return (
    <UiRadioGroup
      legend={label}
      name={name}
      value={value}
      options={options}
      onChange={(event) => {
        const option = options.find((candidate) => candidate.value === event.currentTarget.value)
        if (option) onChange(option.value)
        onBlur()
      }}
      hint={hint}
      error={validationMessage(errors)}
      required={required}
    />
  )
}
