import type { NextTimer, Pending, Schema } from '../wire'
import { type AnyRun, manifestPath, runAt, stepAt } from './children'
import type { Held } from './runs'

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((part, index) => part === b[index])

interface Record_ {
  readonly kind?: string
  readonly status?: string
  readonly attempt?: number
  readonly retryAt?: number
  readonly each?: { readonly keys: readonly string[] }
}

interface Timer_ {
  readonly at: number
  readonly purpose?: NextTimer['purpose']
  readonly step?: string
}

/** One run of the tree, the root or a live child, with the path that reaches it. */
interface Scope {
  readonly path: readonly string[]
  readonly run: AnyRun
}

/** The root run and every child run that can be reached, parents first. */
function scopesOf(root: AnyRun): readonly Scope[] {
  const out: Scope[] = []
  const walk = (path: readonly string[], run: AnyRun) => {
    out.push({ path, run })
    const steps = run.getState().steps as Readonly<Record<string, Record_ | undefined>>
    for (const [id, record] of Object.entries(steps)) {
      if (record?.kind !== 'child' || record.status === 'idle') continue
      const items =
        record.each === undefined ? [[id]] : record.each.keys.map((_, i) => [id, `${i}`])
      for (const tail of items) {
        const at = [...path, ...tail]
        const child = runAt(root, at)
        if (child !== undefined) walk(at, child)
      }
    }
  }
  walk([], root)
  return out
}

/** How many attempts the step's retry policy allows in all, from the manifest. */
function attemptsOf(item: Held, path: readonly string[], step: string): number | undefined {
  const where = manifestPath(item.run, path)
  const node = item.loaded.info.manifest.nodes.find(
    (entry) => entry.id === step && same(entry.path, where),
  )
  return node?.retry === undefined ? undefined : node.retry.retries + 1
}

/**
 * Steps that run work right now in any run of the tree: a hook in its `running` phase, or an
 * undo hook (`undo`) while the run undoes finished work.
 */
function running(scopes: readonly Scope[]) {
  const out: { path: readonly string[]; step: string; record: Record_; undo: boolean }[] = []
  for (const { path, run } of scopes) {
    const steps = run.getState().steps as Readonly<Record<string, Record_ | undefined>>
    for (const [step, record] of Object.entries(steps)) {
      if (record === undefined || record.kind === 'child') continue
      if (record.status === 'compensating') out.push({ path, step, record, undo: true })
      else if (record.status === 'active' && run.explain(step as never).phase === 'running')
        out.push({ path, step, record, undo: false })
    }
  }
  return out
}

/**
 * What the run's next timer is for. The engine stores retry delays, sleeps and event timeouts
 * with their step. A run timeout lives only in the scheduler, so a timer the state does not
 * list is the timeout of the step that runs work, when exactly one step does.
 */
export function timerOf(item: Held): NextTimer | undefined {
  const at = item.clock.next()
  if (at === undefined) return undefined
  const scopes = scopesOf(item.run)
  let found: { path: readonly string[]; timer: Timer_ } | undefined
  for (const { path, run } of scopes) {
    const timers = run.getState().timers as Readonly<Record<string, Timer_>>
    for (const timer of Object.values(timers))
      if (found === undefined || timer.at < found.timer.at) found = { path, timer }
  }
  // The engine and the dev clock read the time a moment apart.
  if (found !== undefined && Math.abs(found.timer.at - at) <= 50) {
    const { path, timer } = found
    const step = timer.step
    if (step === undefined) return { at, purpose: timer.purpose ?? 'unknown', path }
    const record = stepAt(item.run, path, step) as Record_ | undefined
    const attempts = attemptsOf(item, path, step)
    const attempt =
      timer.purpose === 'retry' && record?.attempt !== undefined ? record.attempt + 1 : undefined
    return {
      at,
      purpose: timer.purpose ?? 'unknown',
      path,
      step,
      ...(attempt === undefined ? {} : { attempt }),
      ...(attempts === undefined ? {} : { attempts }),
    }
  }
  const steps = running(scopes)
  const only = steps.length === 1 ? steps[0] : undefined
  if (only === undefined) return { at, purpose: 'unknown', path: [] }
  if (only.undo) return { at, purpose: 'undoTimeout', path: only.path, step: only.step }
  const attempts = attemptsOf(item, only.path, only.step)
  return {
    at,
    purpose: 'timeout',
    path: only.path,
    step: only.step,
    ...(only.record.attempt === undefined ? {} : { attempt: only.record.attempt }),
    ...(attempts === undefined ? {} : { attempts }),
  }
}

/**
 * The step that made a service call, when exactly one step runs work or undoes it. The fallback
 * for a call the run's events could not name.
 */
function callerOf(item: Held) {
  const steps = running(scopesOf(item.run))
  const only = steps.length === 1 ? steps[0] : undefined
  if (only === undefined) return {}
  if (only.undo) return { step: only.step, path: only.path, undo: true as const }
  const attempts = attemptsOf(item, only.path, only.step)
  return {
    step: only.step,
    path: only.path,
    ...(only.record.attempt === undefined ? {} : { attempt: only.record.attempt }),
    ...(attempts === undefined ? {} : { attempts }),
  }
}

/** The step the run's events say made the call, with its attempt and retry policy. */
function namedCaller(item: Held, id: string) {
  const found = item.callers.of(id)
  if (found === undefined) return undefined
  if (found.undo === true) return { step: found.step, path: found.path, undo: true as const }
  const attempts = attemptsOf(item, found.path, found.step)
  return {
    step: found.step,
    path: found.path,
    ...(found.attempt === undefined ? {} : { attempt: found.attempt }),
    ...(attempts === undefined ? {} : { attempts }),
  }
}

/** True when a step in any run of the tree waits out a retry delay. */
export function retryingOf(item: Held): boolean {
  return scopesOf(item.run).some(({ run }) =>
    Object.values(run.getState().steps as Readonly<Record<string, Record_ | undefined>>).some(
      (record) => record?.status === 'active' && record.retryAt !== undefined,
    ),
  )
}

/** True for what a person supplies. A sleep fires on its own, so it is not counted. */
export const forPerson = (item: Pending): boolean => item.kind !== 'sleep'

/**
 * Everything a run waits for that a person can supply: a form, an event, a deadline, a service
 * call answered by hand, and a failed step to retry or skip.
 */
export function pendingOf(item: Held): readonly Pending[] {
  const { manifest } = item.loaded.info
  const state = item.run.getState()
  const out: Pending[] = []

  const { examples } = item.loaded.info
  const calls = item.manual.pending()
  const only = calls.length > 0 ? callerOf(item) : {}
  for (const call of calls) {
    const example = examples.calls?.[call.name]
    const caller = namedCaller(item, call.id) ?? only
    out.push({ kind: 'call', ...call, ...(example === undefined ? {} : { example }), ...caller })
  }

  if (state.status === 'halted') {
    for (const [step, record] of Object.entries(state.steps)) {
      const failed = record as { readonly status?: string; readonly error?: unknown }
      if (failed.status === 'failed')
        out.push({
          kind: 'failed',
          step,
          ...(failed.error === undefined ? {} : { error: failed.error }),
        })
    }
  }

  for (const wait of item.run.waitingFor()) {
    const path = [...wait.path] as string[]
    const step = String(wait.step)
    if (wait.kind === 'view') {
      const where = manifestPath(item.run, path)
      const node = manifest.nodes.find((entry) => entry.id === step && same(entry.path, where))
      const draft = stepAt(item.run, path, step)?.input ?? examples.forms?.[step]
      out.push({
        kind: 'view',
        path,
        step,
        ...(node?.input === undefined ? {} : { schema: node.input }),
        ...(draft === undefined ? {} : { draft }),
      })
    } else if (wait.kind === 'event') {
      out.push({
        kind: 'event',
        path,
        step,
        events: wait.events.map((name) => {
          const schema: Schema | undefined = manifest.schemas.events[String(name)]
          const origin = item.loaded.info.events[String(name)]
          const example = examples.events?.[String(name)]
          return {
            name: String(name),
            ...(schema === undefined ? {} : { schema }),
            ...(origin === undefined ? {} : { origin }),
            ...(example === undefined ? {} : { example }),
          }
        }),
        ...(wait.deadline === undefined ? {} : { deadline: wait.deadline }),
      })
    } else {
      out.push({ kind: 'sleep', path, step, deadline: wait.deadline })
    }
  }
  return out
}
