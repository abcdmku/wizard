import { bindReact } from '@openwizard/react'
import type { reviewsClient } from '../advanced/mapped-children'

export const reviewsUI = bindReact<typeof reviewsClient>()

function ReviewForm() {
  const decision = reviewsUI.useChild('batch', 0).useStep('decision')
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        const changed = await decision.setInput({ approved: true })
        if (changed.ok) await decision.next()
      }}
    >
      <button type="submit">Approve first order</button>
    </form>
  )
}

export function FirstReview() {
  const child = reviewsUI.useChild('batch', 0)
  const state = child.useSnapshot()
  return state === null ? <p>Waiting for the first review.</p> : <ReviewForm />
}
