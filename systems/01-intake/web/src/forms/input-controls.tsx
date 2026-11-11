import { InputField, SelectField, TextareaField } from '../components'
import { validationMessage } from './form-errors'

interface FieldTextProps {
  id: string
  label: string
  name: string
  errors: readonly unknown[]
  hint?: string
  required?: boolean
}

interface TextControlProps extends FieldTextProps {
  value: string
  onBlur: () => void
  onChange: (value: string) => void
  type?: 'date' | 'email' | 'text'
  autoComplete?: string
  maxLength?: number
}

export function TextControl({
  id,
  label,
  name,
  value,
  onBlur,
  onChange,
  errors,
  hint,
  required,
  type = 'text',
  autoComplete,
  maxLength,
}: TextControlProps) {
  return (
    <InputField
      id={id}
      label={label}
      name={name}
      type={type}
      value={value}
      onBlur={onBlur}
      onChange={(event) => onChange(event.currentTarget.value)}
      autoComplete={autoComplete}
      maxLength={maxLength}
      hint={hint}
      error={validationMessage(errors)}
      required={required}
    />
  )
}

interface NumberControlProps extends FieldTextProps {
  value: number
  onBlur: () => void
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}

export function NumberControl({
  id,
  label,
  name,
  value,
  onBlur,
  onChange,
  errors,
  hint,
  required,
  min,
  max,
  step,
}: NumberControlProps) {
  return (
    <InputField
      id={id}
      label={label}
      name={name}
      type="number"
      value={Number.isNaN(value) ? '' : value}
      onBlur={onBlur}
      onChange={(event) =>
        onChange(event.currentTarget.value === '' ? Number.NaN : event.currentTarget.valueAsNumber)
      }
      min={min}
      max={max}
      step={step}
      hint={hint}
      error={validationMessage(errors)}
      required={required}
    />
  )
}

export interface SelectOption<T extends string> {
  label: string
  value: T
}

interface SelectControlProps<T extends string> extends FieldTextProps {
  value: T
  options: readonly SelectOption<T>[]
  onBlur: () => void
  onChange: (value: T) => void
}

export function SelectControl<T extends string>({
  id,
  label,
  name,
  value,
  options,
  onBlur,
  onChange,
  errors,
  hint,
  required,
}: SelectControlProps<T>) {
  return (
    <SelectField
      id={id}
      label={label}
      name={name}
      value={value}
      onBlur={onBlur}
      onChange={(event) => {
        const option = options.find((candidate) => candidate.value === event.currentTarget.value)
        if (option) onChange(option.value)
      }}
      hint={hint}
      error={validationMessage(errors)}
      required={required}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </SelectField>
  )
}

interface TextAreaControlProps extends FieldTextProps {
  value: string
  onBlur: () => void
  onChange: (value: string) => void
  maxLength?: number
  rows?: number
}

export function TextAreaControl({
  id,
  label,
  name,
  value,
  onBlur,
  onChange,
  errors,
  hint,
  required,
  maxLength,
  rows = 6,
}: TextAreaControlProps) {
  return (
    <TextareaField
      id={id}
      label={label}
      name={name}
      value={value}
      onBlur={onBlur}
      onChange={(event) => onChange(event.currentTarget.value)}
      maxLength={maxLength}
      rows={rows}
      hint={hint}
      error={validationMessage(errors)}
      required={required}
    />
  )
}
