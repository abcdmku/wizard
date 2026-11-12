import type { Pending, Schema } from '../wire'
import { manifestPath, stepAt } from './children'
import type { Held } from './runs'

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((part, index) => part === b[index])

/**
 * Everything a run waits for that a person can supply: a form, an event, a deadline, a service
 * call answered by hand, and a failed step to retry or skip.
 */
export function pendingOf(item: Held): readonly Pending[] {
  const { manifest } = item.loaded.info
  const state = item.run.getState()
  const out: Pending[] = []

  const { examples } = item.loaded.info
  for (const call of item.manual.pending()) {
    const example = examples.calls?.[call.name]
    out.push({ kind: 'call', ...call, ...(example === undefined ? {} : { example }) })
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
