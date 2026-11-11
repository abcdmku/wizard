/** Constant-time activity derivation for a child or mapped children. @internal */

import type { StepRecord } from './state'

export function childActivity(record: StepRecord): 'running' | 'waiting' | 'halted' {
  const each = record.each
  if (each === undefined) {
    const status = record.child?.status
    return status === 'waiting' || status === 'halted' ? status : 'running'
  }
  if (each.retrying > 0 || each.running > each.childWaiting + each.childHalted) return 'running'
  if (each.childHalted > 0) return 'halted'
  return each.childWaiting > 0 ? 'waiting' : 'running'
}
