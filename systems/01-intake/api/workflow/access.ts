import type { Command } from '@openwizard/core'
import type { Viewer } from '../../shared/index.js'
import type { IntakeFlow } from './flow.js'
import type { IntakeState } from './status.js'

export interface IntakeAuthorizationArgs {
  readonly state: IntakeState
  readonly command: Command<IntakeFlow>
  readonly scope: Viewer
}

export function authorizeIntakeCommand({
  state,
  command,
  scope,
}: IntakeAuthorizationArgs): boolean {
  if (scope.tenantId !== state.context.tenantId) return false
  if (scope.role === 'reviewer') {
    return (
      command.type === 'send' &&
      command.event === 'review.decided' &&
      state.steps.manualReview.status === 'active'
    )
  }
  if (scope.applicantId !== state.context.applicantId) return false
  switch (command.type) {
    case 'start':
    case 'next':
    case 'back':
    case 'go':
    case 'cancel':
      return true
    case 'setInput':
    case 'resetInput':
      return command.step === state.current
    default:
      return false
  }
}
