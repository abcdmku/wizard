import { type FormEvent, useEffect, useRef, useState } from 'react'
import type { Delivery, InterventionAction } from '../model'
import { Icon } from './Icon'

const actionCopy: Record<
  InterventionAction,
  { title: string; detail: string; confirm: string; reason: string }
> = {
  contact_driver: {
    title: 'Contact driver',
    detail: 'Request a live check-in from the assigned driver.',
    confirm: 'Send check-in',
    reason: 'Message or context',
  },
  reroute: {
    title: 'Reroute delivery',
    detail: 'Ask dispatch automation to calculate and apply a new route.',
    confirm: 'Request reroute',
    reason: 'Reason for reroute',
  },
  hold: {
    title: 'Place delivery on hold',
    detail: 'Pause the active procedure until an operator releases it.',
    confirm: 'Place on hold',
    reason: 'Reason for hold',
  },
  cancel: {
    title: 'Cancel delivery',
    detail: 'This stops the procedure. The event remains in the audit history.',
    confirm: 'Cancel delivery',
    reason: 'Cancellation reason',
  },
  complete: {
    title: 'Complete delivery',
    detail: 'Confirm that handoff is finished and close operator controls.',
    confirm: 'Mark complete',
    reason: 'Completion note',
  },
}

interface InterventionDialogProps {
  action: InterventionAction
  busy: boolean
  delivery: Delivery
  error: string | undefined
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function InterventionDialog({
  action,
  busy,
  delivery,
  error,
  onCancel,
  onConfirm,
}: InterventionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')
  const copy = actionCopy[action]
  const requiresReason = action === 'cancel' || action === 'hold' || action === 'reroute'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onConfirm(reason)
  }

  return (
    <dialog
      aria-describedby="intervention-detail"
      aria-labelledby="intervention-title"
      className="intervention-dialog"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onCancel()
      }}
      ref={dialogRef}
    >
      <form onSubmit={submit}>
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{delivery.reference}</p>
            <h2 id="intervention-title">{copy.title}</h2>
          </div>
          <button
            aria-label="Close dialog"
            className="icon-button"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        <p id="intervention-detail" className="dialog-detail">
          {copy.detail}
        </p>
        <label className="reason-field">
          <span>
            {copy.reason}
            {requiresReason ? ' · required' : ' · optional'}
          </span>
          <textarea
            autoFocus
            maxLength={280}
            onChange={(event) => setReason(event.currentTarget.value)}
            placeholder="Add a concise note for the audit trail"
            required={requiresReason}
            rows={4}
            value={reason}
          />
          <small>{reason.length}/280</small>
        </label>
        {error ? (
          <div className="inline-alert" role="alert">
            <Icon name="alert" />
            {error}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button className="secondary-button" disabled={busy} onClick={onCancel} type="button">
            Keep delivery
          </button>
          <button
            className={action === 'cancel' ? 'primary-button danger' : 'primary-button'}
            disabled={busy}
            type="submit"
          >
            {busy ? 'Sending…' : copy.confirm}
          </button>
        </div>
      </form>
    </dialog>
  )
}
