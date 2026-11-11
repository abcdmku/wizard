import type { Run } from '@openwizard/core'
import { Devtools } from '@openwizard/devtools'
import '@openwizard/devtools/style.css'
import type { signup } from '../learn/form' // the wizard from Forms

export function SignupTools({ run }: { run: Run<typeof signup> }) {
  return <Devtools source={run} />
}
