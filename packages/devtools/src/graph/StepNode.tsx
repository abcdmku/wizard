/**
 * The step card (`type: 'step'`) and the child-flow container (`type: 'group'`): id + kind chip,
 * a warnings badge, the authored hooks / `dependsOn` / `timeout` as flag chips, and the live
 * overlay — `data-status` / `data-phase` colour the ring, `data-current` marks the cursor view.
 */

import type { NodeProps } from '@xyflow/react'
import { memo, type ReactElement } from 'react'
import { formatMs } from '../layout/model'
import { Handles } from './Handles'
import type { GroupNode, StepNode, StepNodeData } from './to-react-flow'

const MAX_FLAGS = 4

function flagsOf(data: StepNodeData): string[] {
  const { step } = data
  const flags: string[] = []
  if (step.dependsOn !== undefined)
    flags.push('any' in step.dependsOn ? 'dependsOn (any)' : 'dependsOn')
  if (step.timeout !== undefined) flags.push(`timeout ${formatMs(step.timeout)}`)
  if (step.dynamicNext === true) flags.push('dynamic next')
  for (const hook of step.hooks) if (hook !== 'run') flags.push(hook)
  return flags
}

function Head({ data }: { readonly data: StepNodeData }): ReactElement {
  const { step, live, warnings } = data
  return (
    <div className="owd-node-head">
      <span className="owd-node-id" title={data.nodeKey}>
        {step.id}
      </span>
      <span className="owd-chip owd-kind" data-kind={step.kind}>
        {step.kind}
      </span>
      {step.start === true && (
        <span className="owd-chip owd-start" title="entry point">
          start
        </span>
      )}
      {warnings.length > 0 && (
        <span className="owd-chip owd-warning" title={warnings.join(', ')}>
          ⚠ {warnings.length}
        </span>
      )}
      {live !== undefined && (
        <span
          className="owd-status-dot"
          data-status={live.status}
          data-phase={live.phase}
          title={live.phase ?? live.status}
        />
      )}
    </div>
  )
}

function Flags({ data }: { readonly data: StepNodeData }): ReactElement | null {
  const flags = flagsOf(data)
  if (flags.length === 0 && data.step.label === undefined) return null
  const shown = flags.slice(0, MAX_FLAGS)
  const rest = flags.length - shown.length
  return (
    <div className="owd-node-flags">
      {data.step.label !== undefined && <span className="owd-node-label">{data.step.label}</span>}
      {shown.map((flag) => (
        <span key={flag} className="owd-flag">
          {flag}
        </span>
      ))}
      {rest > 0 && (
        <span className="owd-flag owd-flag-more" title={flags.slice(MAX_FLAGS).join(', ')}>
          +{rest}
        </span>
      )}
    </div>
  )
}

function StepNodeView({ data }: NodeProps<StepNode>): ReactElement {
  return (
    <>
      <Handles />
      <div
        className="owd-node-card"
        data-status={data.live?.status}
        data-phase={data.live?.phase}
        data-current={data.current ? 'true' : undefined}
        data-selected={data.selected ? 'true' : undefined}
      >
        <Head data={data} />
        <Flags data={data} />
      </div>
    </>
  )
}

function GroupNodeView({ data }: NodeProps<GroupNode>): ReactElement {
  return (
    <>
      <Handles />
      <div
        className="owd-group"
        data-status={data.live?.status}
        data-phase={data.live?.phase}
        data-selected={data.selected ? 'true' : undefined}
      >
        <div className="owd-group-head">
          <Head data={data} />
          <Flags data={data} />
        </div>
      </div>
    </>
  )
}

export const StepNodeComponent = memo(StepNodeView)
export const GroupNodeComponent = memo(GroupNodeView)
