import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react'
import { classNames } from './classNames'
import { joinIds } from './fieldIds'

export interface FormFieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean | undefined
  children: ReactNode
  htmlFor?: string | undefined
  className?: string
  hintId?: string | undefined
  errorId?: string | undefined
}

export function FormField({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className,
  hintId,
  errorId,
}: FormFieldProps) {
  return (
    <div className={classNames('field', Boolean(error) && 'field--error', className)}>
      <div className="field__label-row">
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required ? (
            <>
              <span className="field__required" aria-hidden="true">
                {' '}
                *
              </span>
              <span className="sr-only"> required</span>
            </>
          ) : null}
        </label>
      </div>
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

interface LabeledControlProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
}

export interface InputFieldProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'children'>,
    LabeledControlProps {}

export function InputField({
  label,
  hint,
  error,
  id: suppliedId,
  className,
  required,
  ...props
}: InputFieldProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={id}
      hintId={hintId}
      errorId={errorId}
    >
      <input
        {...props}
        className={classNames('control', className)}
        id={id}
        required={required}
        aria-describedby={joinIds(props['aria-describedby'], hintId, errorId)}
        aria-invalid={error ? true : props['aria-invalid']}
      />
    </FormField>
  )
}

export interface SelectFieldProps extends ComponentPropsWithoutRef<'select'>, LabeledControlProps {}

export function SelectField({
  label,
  hint,
  error,
  id: suppliedId,
  className,
  required,
  children,
  ...props
}: SelectFieldProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={id}
      hintId={hintId}
      errorId={errorId}
    >
      <select
        {...props}
        className={classNames('control', 'control--select', className)}
        id={id}
        required={required}
        aria-describedby={joinIds(props['aria-describedby'], hintId, errorId)}
        aria-invalid={error ? true : props['aria-invalid']}
      >
        {children}
      </select>
    </FormField>
  )
}

export interface TextareaFieldProps
  extends ComponentPropsWithoutRef<'textarea'>,
    LabeledControlProps {}

export function TextareaField({
  label,
  hint,
  error,
  id: suppliedId,
  className,
  required,
  ...props
}: TextareaFieldProps) {
  const generatedId = useId()
  const id = suppliedId ?? generatedId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  return (
    <FormField
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={id}
      hintId={hintId}
      errorId={errorId}
    >
      <textarea
        {...props}
        className={classNames('control', 'control--textarea', className)}
        id={id}
        required={required}
        aria-describedby={joinIds(props['aria-describedby'], hintId, errorId)}
        aria-invalid={error ? true : props['aria-invalid']}
      />
    </FormField>
  )
}
