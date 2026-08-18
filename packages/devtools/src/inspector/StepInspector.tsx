/**
 * `<StepInspector>` — one step in detail: the stored record (status, phase, attempt, timers,
 * error, input / output as JSON), `wizard.explain(step)` (reasons and cursor candidates) and
 * the static facts of the graph node (kind, hooks, `dependsOn`, `timeout`, edges).
 */

import type { FlowGraph } from '@openwizard/core'
import { type CSSProperties, type ReactElement, useMemo } from 'react'
import { useSourceSnapshot } from '../hooks/use-source'
import { formatMs } from '../layout/model'
import {
  type DevtoolsSource,
  type DevtoolsTheme,
  type FlowGraphNode,
  isWizardSource,
  stepKey,
} from '../types'
import { JsonView } from './JsonView'
import { readStep, type StepReading } from './read-step'

/**
 * `<StepInspector>` props: the `source` (wizard or Mirror), the `step` id and the wizard `path`
 * of its flow (`[]` = root), the optional static `graph` for the definition facts.
 * @public
 */
export interface StepInspectorProps {
  readonly source: DevtoolsSource
  readonly step: string
  readonly path?: readonly string[]
  readonly graph?: FlowGraph
  readonly theme?: DevtoolsTheme
  readonly className?: string
  readonly style?: CSSProperties
}

const EMPTY_PATH: readonly string[] = []
const RECORD_FIELDS = [
  'status',
  'attempt',
  'runId',
  'visitedCount',
  'pendingActivation',
  'retryAt',
  'deadline',
  'enteredAt',
  'exitedAt',
  'skipReason',
  'idempotencyKey',
  'when',
] as const

/**
 * The record of a step (status, attempt, error, input / output), why it is where it is
 * (`explain`: reasons + candidates — wizard sources only) and its definition facts.
 * @public
 */
export function StepInspector(props: StepInspectorProps): ReactElement {
  const path = props.path ?? EMPTY_PATH
  const snapshot = useSourceSnapshot(props.source)
  const reading = useMemo(
    () => readStep(props.source, snapshot, path, props.step),
    [props.source, snapshot, path, props.step],
  )
  const node = props.graph?.nodes.find((n) => n.id === props.step && samePath(n.path, path))
  const theme = props.theme ?? 'system'
  return (
    <div
      className={
        props.className === undefined ? 'owd owd-inspector' : `owd owd-inspector ${props.className}`
      }
      data-theme={theme === 'system' ? undefined : theme}
      style={props.style}
    >
      <div className="owd-inspector-head">
        <span className="owd-node-id owd-inspector-title">{stepKey(path, props.step)}</span>
        {node !== undefined && (
          <span className="owd-chip owd-kind" data-kind={node.kind}>
            {node.kind}
          </span>
        )}
      </div>
      {reading.missing !== undefined && <div className="owd-empty">{reading.missing}</div>}
      {reading.record !== undefined && <RecordSection record={reading.record} />}
      {reading.projected !== undefined && <ProjectedSection reading={reading} />}
      <ExplainSection reading={reading} isWizard={isWizardSource(props.source)} />
      {node !== undefined && props.graph !== undefined && (
        <DefinitionSection node={node} graph={props.graph} />
      )}
    </div>
  )
}

function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

function Fact({
  name,
  value,
}: {
  readonly name: string
  readonly value: unknown
}): ReactElement | null {
  if (value === undefined) return null
  return (
    <div className="owd-kv">
      <span className="owd-kv-key">{name}</span>
      <span className="owd-kv-value owd-mono">
        {typeof value === 'string' ? value : JSON.stringify(value)}
      </span>
    </div>
  )
}

function RecordSection({
  record,
}: {
  readonly record: Readonly<Record<string, unknown>>
}): ReactElement {
  const error = record.error
  return (
    <section className="owd-section">
      <h4 className="owd-section-title">record</h4>
      <div className="owd-kv-list" data-status={String(record.status)}>
        {RECORD_FIELDS.map((field) => (
          <Fact key={field} name={field} value={record[field]} />
        ))}
      </div>
      {error !== undefined && <JsonView label="error" value={error} />}
      {record.issues !== undefined && <JsonView label="issues" value={record.issues} />}
      {record.input !== undefined && <JsonView label="input (draft)" value={record.input} />}
      {record.output !== undefined && <JsonView label="output" value={record.output} />}
      {record.previousOutput !== undefined && (
        <JsonView label="previousOutput" value={record.previousOutput} />
      )}
      {record.child !== undefined && <JsonView label="child" value={record.child} />}
    </section>
  )
}

function ProjectedSection({ reading }: { readonly reading: StepReading }): ReactElement | null {
  const p = reading.projected
  if (p === undefined) return null
  return (
    <section className="owd-section">
      <h4 className="owd-section-title">projected</h4>
      <div className="owd-kv-list" data-status={p.status}>
        <Fact name="status" value={p.status} />
        <Fact name="phase" value={p.phase} />
        <Fact name="attempt" value={p.attempt} />
      </div>
      {p.error !== undefined && <JsonView label="error" value={p.error} />}
      {p.issues !== undefined && <JsonView label="issues" value={p.issues} />}
      {p.input !== undefined && <JsonView label="input" value={p.input} />}
      {p.output !== undefined && <JsonView label="output" value={p.output} />}
      {p.child !== undefined && <JsonView label="child" value={p.child} />}
    </section>
  )
}

function ExplainSection({
  reading,
  isWizard,
}: {
  readonly reading: StepReading
  readonly isWizard: boolean
}): ReactElement {
  const x = reading.explanation
  return (
    <section className="owd-section">
      <h4 className="owd-section-title">explain</h4>
      {x === undefined ? (
        <div className="owd-subtle">
          {isWizard ? 'not available for this step' : 'explain() needs a wizard source'}
        </div>
      ) : (
        <>
          <div className="owd-kv-list">
            <Fact name="status" value={x.status} />
            <Fact name="phase" value={x.phase ?? '—'} />
          </div>
          <div className="owd-chips">
            {x.reasons.length === 0 && <span className="owd-chip owd-chip-ok">no blockers</span>}
            {x.reasons.map((reason) => (
              <span key={reason} className="owd-chip owd-chip-reason">
                {reason}
              </span>
            ))}
          </div>
          {x.candidates.length > 0 && <Fact name="candidates" value={x.candidates.join(', ')} />}
        </>
      )}
    </section>
  )
}

function DefinitionSection({
  node,
  graph,
}: {
  readonly node: FlowGraphNode
  readonly graph: FlowGraph
}): ReactElement {
  const outgoing = graph.edges.filter((e) => e.from === node.id && samePath(e.path, node.path))
  const incoming = graph.edges.filter((e) => e.to === node.id && samePath(e.path, node.path))
  return (
    <section className="owd-section">
      <h4 className="owd-section-title">definition</h4>
      <div className="owd-kv-list">
        <Fact name="kind" value={node.kind} />
        <Fact name="label" value={node.label} />
        <Fact name="hooks" value={node.hooks.length === 0 ? '—' : node.hooks.join(', ')} />
        <Fact
          name="dependsOn"
          value={
            node.dependsOn === undefined
              ? undefined
              : 'all' in node.dependsOn
                ? node.dependsOn.all.join(', ')
                : `any of ${node.dependsOn.any.join(', ')}`
          }
        />
        <Fact
          name="timeout"
          value={node.timeout === undefined ? undefined : formatMs(node.timeout)}
        />
        <Fact
          name="next"
          value={
            node.dynamicNext === true
              ? 'dynamic (?)'
              : outgoing
                  .filter((e) => e.kind === 'next')
                  .map((e) => e.to)
                  .join(', ') || '—'
          }
        />
        <Fact
          name="incoming"
          value={incoming.map((e) => `${e.from ?? '▶'} (${e.kind})`).join(', ') || '—'}
        />
        <Fact name="start" value={node.start === true ? 'yes' : undefined} />
      </div>
    </section>
  )
}
