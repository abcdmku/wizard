import type { Command, StepId, ViewId } from '@openwizard/core'
import type { DurableCommandResult, DurableRunHost } from '@openwizard/durable'
import { type IntakeFlow, invalidationRootFor } from '../workflow/index.js'

const INVALIDATABLE = new Set(['done', 'failed', 'skipped'])

export function isDraftMutation(
  command: Command<IntakeFlow>,
): command is Extract<Command<IntakeFlow>, { readonly type: 'setInput' | 'resetInput' }> {
  return command.type === 'setInput' || command.type === 'resetInput'
}

export async function invalidateAfterDraftMutation(
  host: DurableRunHost<IntakeFlow>,
  command: Extract<Command<IntakeFlow>, { readonly type: 'setInput' | 'resetInput' }>,
  commandId: string,
): Promise<DurableCommandResult | undefined> {
  const root = selectRoot(host, command.step)
  if (root === undefined) return undefined
  return host.dispatch(
    { type: 'invalidate', step: root },
    { commandId: `${commandId}:invalidate:${root}` },
  )
}

function selectRoot(
  host: DurableRunHost<IntakeFlow>,
  step: ViewId<IntakeFlow>,
): StepId<IntakeFlow> | undefined {
  const state = host.run.getState()
  if (step === 'businessProfile') {
    const owners = state.steps.beneficialOwners
    if (INVALIDATABLE.has(owners.status)) return 'beneficialOwners'
    return INVALIDATABLE.has(state.steps.eligibility.status) ? 'eligibility' : undefined
  }
  const root = invalidationRootFor(step)
  return root !== undefined && INVALIDATABLE.has(state.steps[root].status) ? root : undefined
}
