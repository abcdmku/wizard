import { bindReact, useRun } from '@openwizard/react'
import { useEffect } from 'react'
import { signup } from '../learn/form' // the wizard from Forms

const ui = bindReact<typeof signup>()

function Contact() {
  const contact = ui.useStep('contact')
  return (
    <div>
      <input
        value={contact.input?.email ?? ''}
        onChange={(event) => void contact.setInput({ email: event.target.value })}
      />
      <p>{contact.issues?.[0]?.message}</p>
      <button type="button" onClick={() => void contact.next()}>
        Continue
      </button>
    </div>
  )
}

export function Signup() {
  const run = useRun(() => signup.create({}))
  useEffect(() => void run.start(), [run])
  return (
    <ui.Provider source={run}>
      <Contact />
    </ui.Provider>
  )
}
