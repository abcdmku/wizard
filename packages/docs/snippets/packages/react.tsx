import type { Run } from '@openwizard/core'
import { bindReact } from '@openwizard/react'
import type { signupWizard } from '../learn/form'

const signup = bindReact<typeof signupWizard>()

function ContactForm() {
  const { status } = signup.useSnapshot()
  const contact = signup.useStep('contact')
  const actions = signup.useActions()

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void contact.next()
      }}
    >
      <input
        value={contact.input?.email ?? ''}
        onChange={(event) => void contact.setInput({ email: event.target.value })}
      />
      {contact.issues?.map((issue) => (
        <p key={issue.message}>{issue.message}</p>
      ))}
      <button type="submit">Continue</button>
      <button type="button" onClick={() => void actions.cancel()}>
        Cancel
      </button>
      <p>Run status: {status}</p>
    </form>
  )
}

export function Signup({ run }: { run: Run<typeof signupWizard> }) {
  return (
    <signup.Provider source={run}>
      <ContactForm />
    </signup.Provider>
  )
}
