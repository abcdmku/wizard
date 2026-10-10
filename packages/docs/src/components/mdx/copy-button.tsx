import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

/** Small "copy to clipboard" button; shows a check mark for a moment after copying. */
export function CopyButton({
  text,
  className = '',
  label = 'Copy',
}: {
  readonly text: string | (() => string)
  readonly className?: string
  readonly label?: string
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can be denied (insecure context); nothing to do.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white/80 px-1.5 py-1 text-[11px] text-neutral-500 backdrop-blur transition-colors hover:text-neutral-900 dark:border-neutral-700 dark:bg-ink-2/80 dark:text-neutral-400 dark:hover:text-neutral-100 ${className}`}
    >
      {copied ? (
        <Check className="h-3 w-3" aria-hidden="true" />
      ) : (
        <Copy className="h-3 w-3" aria-hidden="true" />
      )}
      <span className="sr-only">{copied ? 'Copied' : label}</span>
    </button>
  )
}
