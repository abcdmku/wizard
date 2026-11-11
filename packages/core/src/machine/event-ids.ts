/**
 * Delivered `send` event ids (D8): a bounded, TTL-pruned record kept in the state, so dedupe
 * survives snapshots, resumes and resets. A remembered id is a duplicate delivery that changes
 * nothing; an expired one is a new delivery. Pure.
 *
 * @internal
 */

import type { SeenEventId, WizardState } from './state'
import type { EventIdPolicy, MachineEnv } from './types'

/** 24 hours, 1000 ids. */
export const DEFAULT_EVENT_IDS: EventIdPolicy = { ttlMs: 86_400_000, limit: 1000 }

/** Whether `id` was delivered within the dedupe window. */
export function isDuplicateEvent(env: MachineEnv, state: WizardState, id: string): boolean {
  const { ttlMs } = env.eventIds ?? DEFAULT_EVENT_IDS
  const now = env.now()
  return state.eventIds?.some((seen) => seen.id === id && seen.at + ttlMs > now) === true
}

/** The record after delivering `id` at `at`: expired ids pruned, the oldest beyond `limit` dropped. */
export function rememberEventId(
  env: MachineEnv,
  seen: readonly SeenEventId[] | undefined,
  id: string,
  at: number,
): readonly SeenEventId[] {
  const { ttlMs, limit } = env.eventIds ?? DEFAULT_EVENT_IDS
  const kept = (seen ?? []).filter((entry) => entry.at + ttlMs > at)
  kept.push({ id, at })
  return kept.length > limit ? kept.slice(kept.length - limit) : kept
}
