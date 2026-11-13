/**
 * The step card (`type: 'step'`) and the child wizard container (`type: 'group'`). The first row
 * holds the step id; the second row holds its live status word, the kind when it is not a plain
 * step, and at most two facts that change how the step behaves (waits, timers, retries).
 * `data-tone` tints the card for the status, `data-current` marks the cursor view.
 */

import type { NodeProps } from '@xyflow/react'
import { memo, type ReactElement } from 'react'
import { formatMs } from '../layout/model'
import { Handles } from './Handles'
import { statusWord } from './status-word'
import type { GroupNode, StepNode, StepNodeData } from './to-react-flow'

/** Facts a card shows: two, or one beside a status word, so none is cut to a few letters. */
const MAX_FLAGS = 2
const MAX_FLAGS_LIVE = 1

/** Hooks that are already said by another flag, or that say nothing on a card. */
const QUIET_HOOKS = new Set([
  'run',
  'each',
  'sleep',
  'key',
  'next',
  'idempotencyKey',
  'context',
  'deps',
  'output',
])

/** Facts that change how the step behaves, most telling first. */
function flagsOf(data: StepNodeData): string[] {
  const { step } = data
  const flags: string[] = []
  if (step.waitsFor !== undefined && step.waitsFor.length > 0)
    flags.push(`waits for ${step.waitsFor.join(', ')}`)
  if (step.sleep !== undefined)
    flags.push(step.sleep === 'dynamic' ? 'sleep (dynamic)' : `sleep ${formatMs(step.sleep)}`)
  if (step.each !== undefined) flags.push(`each (${step.each.concurrency} concurrent)`)
  if (step.timeout !== undefined) flags.push(`timeout ${formatMs(step.timeout)}`)
  if (step.retry !== undefined && step.retry.retries > 0) flags.push(`retry ${step.retry.retries}`)
  if (step.fallback !== undefined) flags.push(`fallback ${step.fallback}`)
  if (step.compensable === true) flags.push('undo')
  for (const hook of step.hooks) {
    if (QUIET_HOOKS.has(hook) || hook.startsWith('waitFor:') || hook === 'compensate') continue
    flags.push(hook)
  }
  return flags
}

function Head({ data }: { readonly data: StepNodeData }): ReactElement {
  const { step, warnings } = data
  return (
    <div className="owd-node-head">
      <span className="owd-node-id" title={data.nodeKey}>
        {step.id}
      </span>
      {warnings.length > 0 && (
        <span className="owd-chip owd-warning" title={warnings.join(', ')}>
          ⚠ {warnings.length}
        </span>
      )}
    </div>
  )
}

function Status({ data }: { readonly data: StepNodeData }): ReactElement | null {
  const { live } = data
  const word = statusWord(live, data.step)
  if (word === undefined || live === undefined) return null
  return (
    <span className="owd-node-status" data-tone={word.tone} title={word.title}>
      <span
        className="owd-status-dot"
        data-status={live.status}
        data-phase={live.phase}
        aria-hidden="true"
      />
      {word.text}
    </span>
  )
}

function Flags({ data }: { readonly data: StepNodeData }): ReactElement | null {
  const { step } = data
  const flags = flagsOf(data)
  const kind = step.kind === 'step' ? undefined : step.kind
  const live = statusWord(data.live, step) !== undefined
  if (!live && flags.length === 0 && step.label === undefined && kind === undefined) return null
  const max = live ? MAX_FLAGS_LIVE : MAX_FLAGS
  const shown = flags.slice(0, max)
  const rest = flags.length - shown.length
  return (
    <div className="owd-node-flags">
      <Status data={data} />
      {kind !== undefined && (
        <span className="owd-flag owd-kind" data-kind={kind}>
          {kind}
        </span>
      )}
      {step.label !== undefined && <span className="owd-node-label">{step.label}</span>}
      {shown.map((flag) => (
        <span key={flag} className="owd-flag" title={flag}>
          {flag}
        </span>
      ))}
      {rest > 0 && (
        <span className="owd-flag owd-flag-more" title={flags.slice(max).join(', ')}>
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
        data-tone={statusWord(data.live, data.step)?.tone}
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
        data-tone={statusWord(data.live, data.step)?.tone}
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
