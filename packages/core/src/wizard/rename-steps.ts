/**
 * `renameSteps(snapshot, { oldId: 'newId' })` — the migration helper for a renamed step: rewrites
 * every place a persisted run refers to a step id (records, cursor, history, navigation, saga,
 * timers, failures, child snapshots) so the snapshot resumes under the new definition.
 *
 * @packageDocumentation
 */

import { eachChildAddress, parseEachChildAddress } from '../machine/child-address'
import { isRecord } from '../record'

type Renames = Readonly<Record<string, string>>

/**
 * Rename step ids in a persisted snapshot (the root wizard's steps; a renamed child step keeps its
 * child snapshot). Use it inside `migrate` after bumping the wizard's `version`:
 * `wizard.resume(saved, { migrate: (s) => renameSteps(s, { pay: 'charge' }) })`.
 * The input is not mutated; anything that is not a snapshot is returned unchanged.
 * @public
 */
export function renameSteps(snapshot: unknown, renames: Renames): unknown {
  if (!isRecord(snapshot) || !isRecord(snapshot.state)) return snapshot
  const id = (value: unknown): unknown =>
    typeof value === 'string' && Object.hasOwn(renames, value) ? renames[value] : value
  const ids = (value: unknown): unknown => (Array.isArray(value) ? value.map(id) : value)
  const state = snapshot.state
  const renamed: Record<string, unknown> = {
    ...state,
    ...(isRecord(state.steps) ? { steps: renameKeys(state.steps, id, renameRecord(id)) } : {}),
    active: ids(state.active),
    current: id(state.current),
    history: ids(state.history),
    ...(isRecord(state.nav) ? { nav: renameNav(state.nav, id, ids) } : {}),
    ...(isRecord(state.saga) ? { saga: renameSaga(state.saga, id, ids) } : {}),
    ...(isRecord(state.timers) ? { timers: renameTimers(state.timers, id) } : {}),
    ...(isRecord(state.failure) ? { failure: withStep(state.failure, id) } : {}),
    ...(isRecord(state.terminal) ? { terminal: renameTerminal(state.terminal, id) } : {}),
  }
  return {
    ...snapshot,
    state: renamed,
    ...(isRecord(snapshot.children)
      ? {
          children: renameKeys(snapshot.children, (key) => {
            if (
              typeof key !== 'string' ||
              (isRecord(state.steps) && Object.hasOwn(state.steps, key))
            )
              return id(key)
            const item = parseEachChildAddress(key)
            return item === undefined
              ? id(key)
              : eachChildAddress(
                  String(id(item.step)),
                  item.index,
                  item.key,
                  isRecord(renamed.steps) ? renamed.steps : undefined,
                )
          }),
        }
      : {}),
  }
}

type Rename = (value: unknown) => unknown

function renameKeys(
  record: Record<string, unknown>,
  id: Rename,
  value: (item: unknown) => unknown = (item) => item,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record)) {
    Object.defineProperty(out, String(id(key)), {
      value: value(item),
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return out
}

function renameRecord(id: Rename): (rec: unknown) => unknown {
  return (rec) => (isRecord(rec) ? { ...rec, id: id(rec.id) } : rec)
}

function withStep(value: unknown, id: Rename): unknown {
  return isRecord(value) && 'step' in value ? { ...value, step: id(value.step) } : value
}

function renameNav(nav: Record<string, unknown>, id: Rename, ids: Rename): unknown {
  return {
    ...nav,
    ...('from' in nav ? { from: id(nav.from) } : {}),
    ...('targets' in nav ? { targets: ids(nav.targets) } : {}),
    ...('pendingSteps' in nav ? { pendingSteps: ids(nav.pendingSteps) } : {}),
    ...('cursorHint' in nav ? { cursorHint: id(nav.cursorHint) } : {}),
    ...(Array.isArray(nav.deferred)
      ? {
          deferred: nav.deferred.map((d) =>
            isRecord(d) ? { ...d, step: id(d.step), ...('to' in d ? { to: id(d.to) } : {}) } : d,
          ),
        }
      : {}),
  }
}

function renameSaga(saga: Record<string, unknown>, id: Rename, ids: Rename): unknown {
  const refs = (value: unknown): unknown =>
    Array.isArray(value) ? value.map((ref) => withStep(ref, id)) : value
  return {
    ...saga,
    stack: refs(saga.stack),
    compensated: refs(saga.compensated),
    failures: refs(saga.failures),
    ...('settling' in saga ? { settling: ids(saga.settling) } : {}),
    ...('inFlight' in saga ? { inFlight: withStep(saga.inFlight, id) } : {}),
  }
}

/** Retry / wait timers are keyed `retry:<step>` / `wait:<step>` and name their owner step. */
function renameTimers(timers: Record<string, unknown>, id: Rename): Record<string, unknown> {
  const timerId = (key: string): string => {
    const match = /^(retry|wait|sleep):(.*)$/.exec(key)
    if (match !== null) return `${match[1]}:${String(id(match[2]))}`
    const each = /^each-retry:(.*):(\d+)$/.exec(key)
    if (each === null) return key
    try {
      return `each-retry:${encodeURIComponent(String(id(decodeURIComponent(each[1] ?? ''))))}:${each[2]}`
    } catch {
      return key
    }
  }
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(timers)) {
    const next = timerId(key)
    if (!isRecord(entry)) {
      out[next] = entry
      continue
    }
    const fire =
      isRecord(entry.fire) && entry.fire.type === 'timer.fired'
        ? { ...entry.fire, timerId: next }
        : entry.fire
    out[next] = { ...entry, ...('step' in entry ? { step: id(entry.step) } : {}), fire }
  }
  return out
}

function renameTerminal(terminal: Record<string, unknown>, id: Rename): unknown {
  const compensation = terminal.compensation
  return {
    ...terminal,
    ...('failure' in terminal ? { failure: withStep(terminal.failure, id) } : {}),
    ...(isRecord(compensation) && Array.isArray(compensation.failures)
      ? {
          compensation: {
            ...compensation,
            failures: compensation.failures.map((f) => withStep(f, id)),
          },
        }
      : {}),
  }
}
