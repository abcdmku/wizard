/**
 * The `call` effect builder shared by the planners: token = the record's runId (or an explicit
 * one for compensation) + optional attempt / txId; `extra` travels to the hook and back.
 * @internal
 */

import type { HookName, ResultToken } from './commands'
import type { CallEffect } from './effects'
import type { StepRecord } from './state'
import type { MachineEnv } from './types'

export interface CallOpts {
  readonly extra?: Readonly<Record<string, unknown>>
  readonly attempt?: number
  readonly txId?: string
  readonly timeoutMs?: number
  /** Token runId override (compensation targets a stack entry, not the record's current run). */
  readonly runId?: number
}

export function call(
  env: MachineEnv,
  rec: StepRecord,
  hook: HookName,
  opts: CallOpts = {},
): CallEffect {
  const token: ResultToken = {
    step: rec.id,
    runId: opts.runId ?? rec.runId,
    ...(opts.attempt !== undefined ? { attempt: opts.attempt } : {}),
    ...(opts.txId !== undefined ? { txId: opts.txId } : {}),
  }
  return {
    kind: 'call',
    effectId: env.id('fx'),
    step: rec.id,
    hook,
    token,
    ...(opts.extra !== undefined ? { extra: opts.extra } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  }
}
