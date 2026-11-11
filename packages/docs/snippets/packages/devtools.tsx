import type { Run } from '@openwizard/core'
import { Devtools } from '@openwizard/devtools'
import '@openwizard/devtools/style.css'
import type { hello } from '../../../../examples/01-happy-path/src/hello'

export function WorkflowTools({ run }: { run: Run<typeof hello> }) {
  return <Devtools source={run} />
}
