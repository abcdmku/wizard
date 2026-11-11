import type { SnapshotMigration } from '@openwizard/core'
import { intakeWizard } from './wizard.js'

/** Context fields that version 1 wrote from hooks. Version 2 reads the step outputs instead. */
const HOOK_WRITTEN_CONTEXT_V1 = [
  'consent',
  'businessProfile',
  'beneficialOwners',
  'eligibility',
  'standardFinancials',
  'hardshipEvidence',
  'appeal',
  'riskJobId',
  'risk',
  'reviewerDecision',
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Lets a run saved by version 1 continue. Every removed context field was a copy of the output
 * of the step that wrote it, so the migration only drops the copies.
 */
export const migrateIntakeSnapshot: SnapshotMigration = (snapshot, from) => {
  if (from.name !== intakeWizard.name || from.version !== 1 || !isRecord(snapshot)) return snapshot
  const state = snapshot.state
  if (!isRecord(state) || !isRecord(state.context)) return snapshot
  const context = { ...state.context }
  for (const key of HOOK_WRITTEN_CONTEXT_V1) delete context[key]
  return { ...snapshot, state: { ...state, context } }
}
