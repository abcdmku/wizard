import {
  type ChangeEventHandler,
  type ComponentPropsWithoutRef,
  type ReactNode,
  useId,
} from 'react'
import { classNames } from './classNames'
import { joinIds } from './fieldIds'

export interface CheckboxFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'type'> {
  label: ReactNode
  description?: ReactNode
  error?: ReactNode
}

export function CheckboxField({
  label,
  description,
  error,
  id: suppliedId,
  className,
  ...props
}: CheckboxFieldProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <div
      className={classNames('field', 'field--choice', Boolean(error) && 'field--error', className)}
    >
      <label className="choice" htmlFor={id}>
        <input
          {...props}
          id={id}
          type="checkbox"
          aria-describedby={joinIds(props['aria-describedby'], descriptionId, errorId)}
          aria-invalid={error ? true : props['aria-invalid']}
        />
        <span className="choice__copy">
          <span className="choice__label">{label}</span>
          {description ? (
            <span className="choice__description" id={descriptionId}>
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export interface RadioOption {
  value: string
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export interface RadioGroupProps {
  legend: ReactNode
  name: string
  options: readonly RadioOption[]
  value?: string | undefined
  defaultValue?: string | undefined
  onChange?: ChangeEventHandler<HTMLInputElement> | undefined
  hint?: ReactNode
  error?: ReactNode
  required?: boolean | undefined
  disabled?: boolean | undefined
  className?: string | undefined
}

export function RadioGroup({
  legend,
  name,
  options,
  value,
  defaultValue,
  onChange,
  hint,
  error,
  required,
  disabled,
  className,
}: RadioGroupProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <fieldset
      className={classNames('field', 'radio-group', Boolean(error) && 'field--error', className)}
      aria-describedby={joinIds(hintId, errorId)}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
    >
      <legend className="field__label">
        {legend}
        {required ? (
          <span className="field__required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="sr-only"> required</span> : null}
      </legend>
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      <div className="radio-group__options">
        {options.map((option, index) => {
          const optionId = `${id}-${index}`
          return (
            <label className="choice choice--radio" htmlFor={optionId} key={option.value}>
              <input
                id={optionId}
                name={name}
                type="radio"
                value={option.value}
                checked={value === undefined ? undefined : value === option.value}
                defaultChecked={value === undefined && defaultValue === option.value}
                onChange={onChange}
                required={required && index === 0}
                disabled={option.disabled}
              />
              <span className="choice__copy">
                <span className="choice__label">{option.label}</span>
                {option.description ? (
                  <span className="choice__description">{option.description}</span>
                ) : null}
              </span>
            </label>
          )
        })}
      </div>
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}
