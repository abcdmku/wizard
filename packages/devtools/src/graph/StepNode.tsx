/**
 * The step card (`type: 'step'`) and the child wizard container (`type: 'group'`). A card is
 * compact: the step id, then one row with its live status word, or with its kind (`form`,
 * `wait`, ...) and the one fact that tells most when it has no status, and for a join or an
 * `each` step a third line that stays while the run is live. Everything else is in
 * the card's tooltip. `data-tone` tints the card for the status, `data-current` marks the
 * cursor view.
 */

import type { NodeProps } from '@xyflow/react'
import { memo, type ReactElement } from 'react'
import { allFacts, kindWord, mainFact, subLine } from './card-facts'
import { Handles } from './Handles'
import { type StatusWord, statusWord } from './status-word'
import type { GroupNode, StepNode, StepNodeData } from './to-react-flow'

function wordOf(data: StepNodeData): StatusWord | undefined {
  return statusWord(data.live, data.step, data.attention, data.notRun)
}

/** The host says a person must act, and the word does not already say so. */
function ringOf(data: StepNodeData, word: StatusWord | undefined): 'true' | undefined {
  return data.attention === true && word?.tone !== 'attention' ? 'true' : undefined
}

/** The tooltip: id, label, description, status and every fact. */
function tooltipOf(data: StepNodeData, word: StatusWord | undefined): string {
  const { step } = data
  const lines = [step.label === undefined ? step.id : `${step.id}: ${step.label}`]
  if (step.description !== undefined) lines.push(step.description)
  if (word !== undefined)
    lines.push(word.attempt === undefined ? word.title : `${word.title}, ${word.attempt}`)
  if (ringOf(data, word) !== undefined) lines.push('A person has to act on this step')
  if (data.anyOf.length > 0) lines.push(`Starts when any one of ${data.anyOf.join(', ')} finishes`)
  lines.push(...allFacts(step))
  if (data.warnings.length > 0) lines.push(`Warnings: ${data.warnings.join(', ')}`)
  return lines.join('\n')
}

function Head({ data }: { readonly data: StepNodeData }): ReactElement {
  const { step, warnings } = data
  return (
    <div className="owd-node-head">
      <span className="owd-node-id">{step.id}</span>
      {warnings.length > 0 && (
        <span className="owd-node-warning" role="img" aria-label={`${warnings.length} warning`}>
          !
        </span>
      )}
    </div>
  )
}

function Row({
  data,
  word,
}: {
  readonly data: StepNodeData
  readonly word: StatusWord | undefined
}): ReactElement | null {
  if (word !== undefined)
    return (
      <div className="owd-node-row">
        <span className="owd-node-status" data-tone={word.tone}>
          <span
            className="owd-status-dot"
            data-status={data.live?.status}
            data-phase={data.live?.phase}
            aria-hidden="true"
          />
          {word.text}
        </span>
        {word.attempt !== undefined && (
          <span className="owd-node-fact owd-node-attempt" title={word.attempt}>
            {word.attempt.replace(/^attempt /, '')}
          </span>
        )}
      </div>
    )
  const named = kindWord(data.step)
  // A kind that repeats the step id (a `route` step called `route`) says nothing new, and the
  // third line of an `each` step already says `each`.
  const kind = named === data.step.id || named === 'each' ? undefined : named
  const fact = mainFact(data.step)
  if (kind === undefined && fact === undefined) return null
  return (
    <div className="owd-node-row">
      {kind !== undefined && (
        <span className="owd-kind" data-kind={kind}>
          {kind}
        </span>
      )}
      {fact !== undefined && <span className="owd-node-fact">{fact}</span>}
    </div>
  )
}

/** The third line: `each · 2 at a time`, `any of a, b`. It stays while the run is live. */
function Sub({ data }: { readonly data: StepNodeData }): ReactElement | null {
  const text = subLine(data.step, data.anyOf)
  if (text === undefined) return null
  return <div className="owd-node-sub">{text}</div>
}

function StepNodeView({ data }: NodeProps<StepNode>): ReactElement {
  const word = wordOf(data)
  return (
    <>
      <Handles />
      <div
        className="owd-node-card"
        title={tooltipOf(data, word)}
        data-status={data.live?.status}
        data-phase={data.live?.phase}
        data-tone={word?.tone}
        data-attention={ringOf(data, word)}
        data-current={data.current ? 'true' : undefined}
        data-selected={data.selected ? 'true' : undefined}
      >
        <Head data={data} />
        <Row data={data} word={word} />
        <Sub data={data} />
      </div>
    </>
  )
}

function GroupNodeView({ data }: NodeProps<GroupNode>): ReactElement {
  const word = wordOf(data)
  return (
    <>
      <Handles />
      <div
        className="owd-group"
        data-status={data.live?.status}
        data-phase={data.live?.phase}
        data-tone={word?.tone}
        data-attention={ringOf(data, word)}
        data-selected={data.selected ? 'true' : undefined}
      >
        <div className="owd-group-head" title={tooltipOf(data, word)}>
          <Head data={data} />
          <Row data={data} word={word} />
          <Sub data={data} />
        </div>
      </div>
    </>
  )
}

export const StepNodeComponent = memo(StepNodeView)
export const GroupNodeComponent = memo(GroupNodeView)
