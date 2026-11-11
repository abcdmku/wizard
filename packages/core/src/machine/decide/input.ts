/**
 * Data edits: `setInput` / `resetInput` (view drafts, including dynamic initializer
 * generations) and a hook's `update(patch | fn)` (`context.patch`).
 * @internal
 */

import { toSerializedError } from '../../interpreter/errors'
import { isThenable } from '../../interpreter/thenable'
import type { Batch } from '../batch'
import { emit, rec, stepDef } from '../batch'
import type { Command, InternalMessage } from '../commands'
import { continueAfterInitial, failStep } from '../scheduler'
import { isTerminal } from '../selectors'
import { isPlainObject } from '../util'
import { reject } from './commands'

export function cmdInput(
  b: Batch,
  cmd: Extract<Command, { type: 'setInput' | 'resetInput' }>,
): void {
  const def = stepDef(b, cmd.step)
  const record = rec(b, cmd.step)
  if (def === undefined || record === undefined) {
    reject(b, cmd, 'UNKNOWN_STEP', 'unknown-step')
    return
  }
  if (def.kind !== 'view') {
    reject(b, cmd, 'NOT_A_VIEW', 'not-a-view')
    return
  }
  const nav = b.state.nav
  const targetInitializing =
    nav.phase === 'entering' &&
    nav.pendingSteps?.includes(cmd.step) === true &&
    record.initializing !== undefined
  if ((nav.phase !== 'idle' && nav.from === cmd.step) || targetInitializing) {
    reject(b, cmd, 'NAV_BUSY', 'nav-busy')
    return
  }
  if (cmd.type === 'setInput') {
    const supersedes = record.initializing !== undefined
    emit(b, {
      type: 'input.changed',
      step: cmd.step,
      patch: cmd.patch,
      ...(supersedes ? { reset: false } : {}),
    })
    if (supersedes) continueAfterInitial(b, cmd.step)
    return
  }
  if (record.entering === true && record.initializing === undefined) {
    reject(b, cmd, 'NAV_BUSY', 'nav-busy')
    return
  }
  emit(b, {
    type: 'input.changed',
    step: cmd.step,
    patch: def.hooks.initial !== undefined ? null : (def.initial ?? null),
    reset: true,
  })
}

/**
 * `update(patch)` records the patch. `update(fn)` (D6) applies `fn` to the latest committed
 * context right here, so concurrent hooks never lose each other's writes; `undefined` changes
 * nothing. A throwing, async or non-object `fn` fails the calling step while it still runs.
 */
export function onContextPatch(
  b: Batch,
  msg: Extract<InternalMessage, { type: 'context.patch' }>,
): void {
  if (isTerminal(b.state)) return
  let patch: unknown = msg.patch
  if (typeof patch === 'function') {
    try {
      patch = patch(b.state.context)
      if (isThenable(patch)) throw new TypeError('update(fn) must return the patch synchronously')
      if (patch !== undefined && !isPlainObject(patch))
        throw new TypeError('update(fn) must return a plain object patch')
    } catch (error) {
      if (msg.by !== undefined && rec(b, msg.by)?.status === 'active')
        failStep(b, msg.by, toSerializedError(error), 'hook')
      return
    }
    if (patch === undefined) return
  }
  emit(b, { type: 'context.changed', patch, ...(msg.by !== undefined ? { by: msg.by } : {}) })
}
