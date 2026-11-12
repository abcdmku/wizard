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

const duration = (ms: number): string => {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} h`
  if (ms % 60_000 === 0) return `${ms / 60_000} min`
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`
}

/** Every dependency of a wizard on something outside the run, read from its manifest. */
function rowsOf(wizard: WizardInfo): readonly Row[] {
  const { nodes, schemas } = wizard.manifest
  const label = (node: (typeof nodes)[number]) => [...node.path, node.id].join(' / ')
  const rows: Row[] = []
  for (const node of nodes) {
    if (node.kind === 'view')
      rows.push({ kind: 'form', name: label(node), steps: label(node), detail: fields(node.input) })
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
        name: 'sleep',
        steps: label(node),
        detail: node.sleep === 'dynamic' ? 'set when the step starts' : duration(node.sleep),
      })
    if (node.timeout !== undefined)
      rows.push({
        kind: 'timer',
        name: 'timeout',
        steps: label(node),
        detail: duration(node.timeout),
      })
  }
  for (const name of wizard.services)
    rows.push({ kind: 'service', name, steps: '', detail: 'configured in the dev config' })
  return rows
}

/** What a wizard needs from outside the run, with a badge that tells the kinds apart. */
export function Outside({ wizard }: { readonly wizard: WizardInfo }): ReactElement {
  const rows = rowsOf(wizard)
  const kinds = [...new Set(rows.map((row) => row.kind))].filter((kind) => kind !== 'service')
  return (
    <div className="stack">
      {rows.length === 0 ? (
        <p className="quiet">This wizard waits for nothing outside the run.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Name</th>
              <th>Step that waits</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}:${row.name}:${row.steps}`}>
                <td>
                  <Kind kind={row.kind} />
                </td>
                <td>
                  <code>{row.name}</code>
                </td>
                <td>{row.steps}</td>
                <td>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <dl className="legend">
        {kinds.map((kind) => (
          <div key={kind}>
            <dt>
              <Kind kind={kind} />
            </dt>
            <dd>{MEANING[kind]}</dd>
          </div>
        ))}
        <div>
          <dt>
            <Kind kind="service" />
          </dt>
          <dd>
            A step's code decides which services it calls, so they are not listed until a run makes
            the call. A service the dev config leaves out waits for your answer.
          </dd>
        </div>
      </dl>
    </div>
  )
}
