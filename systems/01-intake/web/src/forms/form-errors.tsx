export function validationMessage(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string') {
      return error
    }
    if (error && typeof error === 'object' && 'message' in error) {
      const message = error.message
      if (typeof message === 'string') {
        return message
      }
    }
  }
  return undefined
}

export function FormNotice({ error }: { error?: string | undefined }) {
  if (!error) return null

  return (
    <div className="form-notice" role="alert">
      {error}
    </div>
  )
}

export function required(value: string, message: string): string | undefined {
  return value.trim().length === 0 ? message : undefined
}

export function validEmail(value: string): string | undefined {
  if (value.trim().length === 0) return 'Enter an email address.'
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? undefined
    : 'Enter an email address in the format name@example.com.'
}
