/**
 * What happens outside a run while it executes: the forms a person fills in, the services a step
 * calls and the events another system sends. A diagram draws these next to the steps.
 */
import type { AnyWizardDefinition, Run, RunEvent } from '@openwizard/core'
import { traceLine } from '@openwizard/core/inspect'

/** A form a view shows. `fields` is the draft, then the submitted value. */
export interface FormCard {
  readonly kind: 'form'
  /** `stepKey` of the view. */
  readonly step: string
  readonly fields: Readonly<Record<string, string>>
  readonly state: 'open' | 'invalid' | 'submitted'
  readonly issue?: string
}

/** One call to a service a scenario passed through `tape.service`. */
export interface CallCard {
  readonly kind: 'call'
  readonly id: number
  readonly name: string
  readonly args: string
  readonly state: 'pending' | 'returned' | 'threw'
  readonly result?: string
}

/** One event sent to the run. */
export interface EventCard {
  readonly kind: 'event'
  readonly id: number
  readonly name: string
  readonly payload: string
  readonly state: 'received' | 'delivered' | 'rejected'
  /** The step that took it, or why it was refused. */
  readonly detail?: string
}

export type OutsideCard = FormCard | CallCard | EventCard

/** A value as short source text: `{ by: 'grace' }`. */
export function show(value: unknown, limit = 64): string {
  if (value === undefined) return ''
  const text =
    typeof value === 'string'
      ? `'${value}'`
      : (JSON.stringify(value) ?? String(value))
          .replace(/"([A-Za-z_$][\w$]*)":/g, '$1: ')
          .replace(/"/g, "'")
          .replace(/,(?=\S)/g, ', ')
          .replace(/^\{(.+)\}$/, '{ $1 }')
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

export interface Outside {
  /** Wrap a service function so every call to it shows up in the diagram. */
  service<A extends unknown[], R>(
    name: string,
    call: (...args: A) => Promise<R>,
  ): (...args: A) => Promise<R>
  /** Feed every event the run reports. */
  observe(event: RunEvent<AnyWizardDefinition>): void
  /** The cards as they stand now, forms read from the run. */
  cards(
    views: readonly {
      readonly key: string
      readonly path: readonly string[]
      readonly id: string
    }[],
    runAt: (path: readonly string[]) => Run<AnyWizardDefinition> | undefined,
  ): readonly OutsideCard[]
}

/** `onCallStarted` runs when a wrapped service is called, after its card exists. */
export function createOutside(onCallStarted: () => void): Outside {
  const calls: CallCard[] = []
  const events: EventCard[] = []
  const issues = new Map<string, string>()
  const forms = new Map<string, FormCard>()
  let nextId = 0

  const replace = <T extends { readonly id: number }>(list: T[], id: number, patch: Partial<T>) => {
    const index = list.findIndex((item) => item.id === id)
    const current = list[index]
    if (current) list[index] = { ...current, ...patch }
  }

  return {
    service(name, call) {
      return async (...args) => {
        nextId += 1
        const id = nextId
        // An options object such as `{ idempotencyKey }` is the last argument. It says nothing new.
        const shown = args.filter((arg) => typeof arg !== 'object' || arg === null)
        calls.push({
          kind: 'call',
          id,
          name,
          args: shown.map((arg) => show(arg, 24)).join(', '),
          state: 'pending',
        })
        onCallStarted()
        try {
          const result = await call(...args)
          replace(calls, id, { state: 'returned', result: show(result) })
          return result
        } catch (error) {
          replace(calls, id, {
            state: 'threw',
            result: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      }
    },
    observe(event) {
      const line = traceLine(event)
      const record = event as unknown as Record<string, unknown>
      if (event.type === 'event.received') {
        nextId += 1
        events.push({
          kind: 'event',
          id: nextId,
          name: line.event,
          payload: show(record.payload),
          state: 'received',
        })
      } else if (event.type === 'event.delivered') {
        const waiting = [...events]
          .reverse()
          .find((item) => item.name === line.event && item.state === 'received')
        if (waiting)
          replace(events, waiting.id, { state: 'delivered', detail: `to ${String(record.to)}` })
      } else if (/^event\./.test(event.type) && / rejected: /.test(line.text)) {
        nextId += 1
        events.push({
          kind: 'event',
          id: nextId,
          name: line.event,
          payload: show(record.payload),
          state: 'rejected',
          detail: line.text.split(' rejected: ')[1] ?? 'rejected',
        })
      } else if (/ input invalid: /.test(line.text)) {
        issues.set(
          [...line.path, line.step].join('/'),
          line.text.split(' input invalid: ')[1] ?? '',
        )
      } else if (/ input (changed|valid)$/.test(line.text)) {
        issues.delete([...line.path, line.step].join('/'))
      }
    },
    cards(views, runAt) {
      for (const view of views) {
        const step = runAt(view.path)?.getState().steps[view.id] as
          | { status: string; input?: unknown; output?: unknown }
          | undefined
        if (!step || step.status === 'idle') continue
        const value = (step.status === 'done' ? step.output : step.input) ?? {}
        const issue = issues.get(view.key)
        forms.set(view.key, {
          kind: 'form',
          step: view.key,
          fields: Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([name, field]) => [
              name,
              typeof field === 'string' ? field : show(field, 28),
            ]),
          ),
          state: step.status === 'done' ? 'submitted' : issue ? 'invalid' : 'open',
          ...(issue && step.status !== 'done' ? { issue } : {}),
        })
      }
      return [...forms.values(), ...[...calls, ...events].sort((a, b) => a.id - b.id)]
    },
  }
}
