/**
 * `<WizardGraph>` in the DOM: every step becomes a card (child steps inside their group), the
 * live overlay lands on the cards (`data-status`, `data-current`), a click reports the selection.
 */
import { inspect } from '@openwizard/core/inspect'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WizardGraph } from '../src/graph/WizardGraph'
import { drawnEdges } from '../src/layout/merge'
import { buildGraphModel } from '../src/layout/model'
import type { GraphSelection } from '../src/types'
import { pipeline } from './fixture'

afterEach(cleanup)

const graph = inspect(pipeline)
const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.owd-node-card')]
const cardOf = (root: HTMLElement, id: string) =>
  cards(root).find((c) => c.querySelector('.owd-node-id')?.textContent === id)

describe('<WizardGraph>', () => {
  it('draws a card per step, the child flow as a group holding its steps, and the warnings badge', async () => {
    const { container } = render(<WizardGraph graph={graph} />)
    await waitFor(() => expect(cards(container).length).toBe(graph.nodes.length - 1)) // pack is a group
    const group = container.querySelector('.react-flow__node-group')
    expect(group?.querySelector('.owd-node-id')?.textContent).toBe('pack')
    // Child cards are React Flow children of the group node (parentId), rendered after it.
    expect(cardOf(container, 'count')).toBeDefined()
    expect(cardOf(container, 'packed')).toBeDefined()
    // Routing targets are explicit, so the graph has only entry markers.
    expect(container.querySelectorAll('.owd-marker[data-variant="entry"]').length).toBe(2)
    expect(container.querySelectorAll('.owd-marker[data-variant="dynamic"]').length).toBe(0)
    // Two edges between the same pair of steps are drawn as one line.
    expect(container.querySelectorAll('.react-flow__edge').length).toBe(
      drawnEdges(buildGraphModel(graph).edges).length,
    )
    if (graph.warnings.length > 0)
      expect(container.querySelector('.owd-badge-warn')?.textContent).toContain(
        String(graph.warnings.length),
      )
  })

  it('overlays statuses / phases and the current view, and updates them without a new layout', async () => {
    const { container, rerender } = render(
      <WizardGraph
        graph={graph}
        statuses={{ form: { status: 'active', phase: 'waiting' }, ingest: { status: 'idle' } }}
        activeStep="form"
      />,
    )
    await waitFor(() => expect(cardOf(container, 'form')?.dataset.status).toBe('active'))
    expect(cardOf(container, 'form')?.dataset.current).toBe('true')
    expect(
      cardOf(container, 'form')?.querySelector('.owd-status-dot')?.getAttribute('data-phase'),
    ).toBe('waiting')
    // The status is a word on the card, not only a colour.
    expect(cardOf(container, 'form')?.querySelector('.owd-node-status')?.textContent).toBe(
      'waiting on you',
    )
    expect(cardOf(container, 'ingest')?.dataset.status).toBe('idle')
    expect(cardOf(container, 'ingest')?.querySelector('.owd-node-status')?.textContent).toBe(
      'blocked',
    )
    expect(cardOf(container, 'gate')?.dataset.status).toBeUndefined()

    rerender(
      <WizardGraph
        graph={graph}
        statuses={{
          form: { status: 'done' },
          ingest: { status: 'active', phase: 'running' },
          'pack/count': { status: 'done' },
        }}
        activeStep={null}
      />,
    )
    await waitFor(() => expect(cardOf(container, 'ingest')?.dataset.status).toBe('active'))
    expect(cardOf(container, 'form')?.dataset.status).toBe('done')
    expect(cardOf(container, 'form')?.dataset.current).toBeUndefined()
    expect(cardOf(container, 'count')?.dataset.status).toBe('done')
    expect(cardOf(container, 'form')?.querySelector('.owd-node-status')?.textContent).toBe('done')
    expect(cardOf(container, 'ingest')?.dataset.tone).toBe('running')
    // The edge from the finished form to the running ingest is the path the run took.
    await waitFor(() =>
      expect(container.querySelector('.react-flow__edge [data-path="taken"]')).not.toBeNull(),
    )
  })

  it('reports a click as { id, path, key } (nested steps carry their path) and the pane click clears it', async () => {
    const seen: Array<GraphSelection | null> = []
    const { container } = render(<WizardGraph graph={graph} onSelect={(s) => seen.push(s)} />)
    await waitFor(() => expect(cardOf(container, 'count')).toBeDefined())
    const count = cardOf(container, 'count')
    if (count === undefined) throw new Error('no card')
    fireEvent.click(count)
    expect(seen.at(-1)).toEqual({ id: 'count', path: ['pack'], key: 'pack/count' })
    await waitFor(() => expect(cardOf(container, 'count')?.dataset.selected).toBe('true'))
    const gate = cardOf(container, 'gate')
    if (gate === undefined) throw new Error('no card')
    fireEvent.click(gate)
    expect(seen.at(-1)).toEqual({ id: 'gate', path: [], key: 'gate' })
    const pane = container.querySelector('.react-flow__pane')
    if (pane === null) throw new Error('no pane')
    fireEvent.click(pane)
    expect(seen.at(-1)).toBeNull()
  })

  it('shows `waiting on you` on the steps named in `attention`, and selects a focused step with Enter', async () => {
    const seen: Array<GraphSelection | null> = []
    const { container } = render(
      <WizardGraph
        graph={graph}
        statuses={{ form: { status: 'active', phase: 'waiting' }, ingest: { status: 'active' } }}
        attention={['ingest']}
        onSelect={(s) => seen.push(s)}
      />,
    )
    await waitFor(() =>
      expect(cardOf(container, 'ingest')?.querySelector('.owd-node-status')?.textContent).toBe(
        'waiting on you',
      ),
    )
    expect(cardOf(container, 'form')?.querySelector('.owd-node-status')?.textContent).toBe(
      'waiting',
    )
    const node = cardOf(container, 'gate')?.closest<HTMLElement>('.react-flow__node')
    if (node === null || node === undefined) throw new Error('no node')
    fireEvent.keyDown(node, { key: 'Enter' })
    expect(seen.at(-1)).toEqual({ id: 'gate', path: [], key: 'gate' })
    fireEvent.keyDown(node, { key: 'Escape' })
    expect(seen.at(-1)).toBeNull()
    const link = container.querySelector('.react-flow__attribution a')
    expect(link?.getAttribute('tabindex')).toBe('-1')
    // The entry marker does nothing when pressed, so it is not a tab stop.
    const marker = container.querySelector('.owd-marker')?.closest('.react-flow__node')
    expect(marker?.getAttribute('tabindex')).toBeNull()
  })

  it('rings a step a person must answer while it is undoing, and says `not run` once the run ended', async () => {
    const { container, rerender } = render(
      <WizardGraph
        graph={graph}
        statuses={{ form: { status: 'compensating', phase: 'compensating' } }}
        attention={['form']}
      />,
    )
    await waitFor(() =>
      expect(cardOf(container, 'form')?.querySelector('.owd-node-status')?.textContent).toBe(
        'undoing',
      ),
    )
    expect(cardOf(container, 'form')?.dataset.attention).toBe('true')
    rerender(
      <WizardGraph
        graph={graph}
        statuses={{ form: { status: 'compensated' }, ingest: { status: 'idle' } }}
        ended
        attribution={false}
      />,
    )
    await waitFor(() =>
      expect(cardOf(container, 'ingest')?.querySelector('.owd-node-status')?.textContent).toBe(
        'not run',
      ),
    )
    expect(cardOf(container, 'form')?.dataset.attention).toBeUndefined()
    expect(container.querySelector('.react-flow__attribution')).toBeNull()
    // While the run undoes its steps, a step it never started will not start either.
    rerender(
      <WizardGraph
        graph={graph}
        statuses={{ form: { status: 'compensating' }, ingest: { status: 'idle' } }}
        runStatus="compensating"
      />,
    )
    await waitFor(() => expect(cardOf(container, 'ingest')?.title).toMatch(/undoing its steps/))
    expect(cardOf(container, 'ingest')?.querySelector('.owd-node-status')?.textContent).toBe(
      'not run',
    )
  })
})
