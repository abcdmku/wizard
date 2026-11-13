import type { ReactElement } from 'react'
import type { Schema, WizardInfo } from '../wire'
import { Kind, MEANING, type OutsideKind } from './kind'

interface Row {
  readonly kind: OutsideKind
  readonly name: string
  readonly steps: string
  readonly detail: string
}

const fields = (schema: Schema | undefined): string => {
  const properties = (schema as { properties?: Record<string, unknown> } | undefined)?.properties
  return properties === undefined ? '' : Object.keys(properties).join(', ')
}

/** `5 min`, `48 h`, `1 s` or `250 ms`. */
export const duration = (ms: number): string => {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`
  if (ms % 60_000 === 0) return `${ms / 60_000} min`
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`
}

/** Every dependency of a wizard on something outside the run, read from its manifest. */
export function rowsOf(wizard: WizardInfo): readonly Row[] {
  const { nodes, schemas } = wizard.manifest
  const label = (node: (typeof nodes)[number]) => [...node.path, node.id].join(' / ')
  const rows: Row[] = []
  for (const node of nodes) {
    if (node.kind === 'view')
      rows.push({ kind: 'form', name: label(node), steps: '', detail: fields(node.input) })
  }
  for (const name of Object.keys(schemas.events)) {
    const origin = wizard.events[name]
    const waiting = nodes.filter((node) => node.waitsFor?.includes(name)).map(label)
    rows.push({
      kind:
        origin?.source === 'webhook' ? 'webhook' : origin?.source === 'queue' ? 'queue' : 'event',
      name,
      steps: waiting.join(', '),
      detail: [
        origin?.from === undefined ? '' : `from ${origin.from}`,
        fields(schemas.events[name]),
      ]
        .filter((part) => part !== '')
        .join(' · '),
    })
  }
  for (const node of nodes) {
    if (node.sleep !== undefined)
      rows.push({
        kind: 'timer',
        name: node.sleep === 'dynamic' ? 'sleep' : `sleep ${duration(node.sleep)}`,
        steps: label(node),
        detail: node.sleep === 'dynamic' ? 'length set when the step starts' : '',
      })
    if (node.timeout !== undefined)
      rows.push({
        kind: 'timer',
        name: `timeout ${duration(node.timeout)}`,
        steps: label(node),
        detail: '',
      })
  }
  for (const name of wizard.services)
    rows.push({ kind: 'service', name, steps: '', detail: 'answered by the dev config' })
  return rows
}

/** What a wizard needs from outside the run, with a badge that tells the kinds apart. */
export function Outside({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  const rows = rowsOf(wizard)
  const kinds = [...new Set(rows.map((row) => row.kind))]
  return (
    <div className="stack">
      {rows.length === 0 ? (
        <p>This wizard needs no form, event or timer. Only its service calls reach outside.</p>
      ) : (
        <ul className="wz-deps">
          {rows.map((row) => (
            <li key={`${row.kind}:${row.name}:${row.steps}`}>
              <Kind kind={row.kind} />
              <span className="wz-dep-main">
                <code>{row.name}</code>
                {row.detail !== '' && <span className="quiet">{row.detail}</span>}
              </span>
              {row.steps !== '' && (
                <span className="wz-dep-step quiet">
                  at <code>{row.steps}</code>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {kinds.length > 0 && (
        <dl className="wz-legend">
          {kinds.map((kind) => (
            <div key={kind}>
              <dt>
                <Kind kind={kind} />
              </dt>
              <dd>{MEANING[kind]}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="wz-hint">
        A run lists each service call when a step makes it, and waits for your answer unless the dev
        config supplies that service.
      </p>
    </div>
  )
}
