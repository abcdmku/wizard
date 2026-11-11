import { Check, CircleAlert, Clock3, LoaderCircle, RotateCcw, X } from 'lucide-react'
import type { DisplayStatus } from '../../contracts'
import { statusLabel, statusTone } from '../../format'

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const tone = statusTone(status)
  return (
    <span className={`status-badge status-${tone}`}>
      <StatusIcon tone={tone} />
      {statusLabel(status)}
    </span>
  )
}

function StatusIcon({ tone }: { tone: string }) {
  if (tone === 'success') return <Check size={13} aria-hidden="true" />
  if (tone === 'danger') return <X size={13} aria-hidden="true" />
  if (tone === 'warning') return <RotateCcw size={13} aria-hidden="true" />
  if (tone === 'active') return <LoaderCircle className="spin" size={13} aria-hidden="true" />
  if (tone === 'neutral') return <Clock3 size={13} aria-hidden="true" />
  return <CircleAlert size={13} aria-hidden="true" />
}
