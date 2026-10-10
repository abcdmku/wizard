/**
 * `<FlowGraph>` in the DOM: every step becomes a card (child steps inside their group), the
 * live overlay lands on the cards (`data-status`, `data-current`), a click reports the selection.
 */
import { inspect } from '@openwizard/core'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FlowGraph } from '../src/graph/FlowGraph'
import type { GraphSelection } from '../src/types'
import { pipeline } from './fixture'

afterEach(cleanup)

const graph = inspect(pipeline)
const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.owd-node-card')]
const cardOf = (root: HTMLElement, id: string) =>
  cards(root).find((c) => c.querySelector('.owd-node-id')?.textContent === id)

describe('<FlowGraph>', () => {
  it('draws a card per step, the child flow as a group holding its steps, and the warnings badge', async () => {
    const { container } = render(<FlowGraph graph={graph} />)
    await waitFor(() => expect(cards(container).length).toBe(graph.nodes.length - 1)) // pack is a group
    const group = container.querySelector('.react-flow__node-group')
    expect(group?.querySelector('.owd-node-id')?.textContent).toBe('pack')
    // Child cards are React Flow children of the group node (parentId), rendered after it.
    expect(cardOf(container, 'count')).toBeDefined()
    expect(cardOf(container, 'packed')).toBeDefined()
    // Markers: one entry per flow + the `?` port of the dynamic decision.
    expect(container.querySelectorAll('.owd-marker[data-variant="entry"]').length).toBe(2)
    expect(container.querySelectorAll('.owd-marker[data-variant="dynamic"]').length).toBe(1)
    expect(container.querySelectorAll('.react-flow__edge').length).toBe(graph.edges.length + 1) // + dynamic
    if (graph.warnings.length > 0)
      expect(container.querySelector('.owd-badge-warn')?.textContent).toContain(
        String(graph.warnings.length),
      )
  })

  it('overlays statuses / phases and the current view, and updates them without a new layout', async () => {
    const { container, rerender } = render(
      <FlowGraph
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
    expect(cardOf(container, 'ingest')?.dataset.status).toBe('idle')
    expect(cardOf(container, 'gate')?.dataset.status).toBeUndefined()

    rerender(
      <FlowGraph
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
  })

  it('reports a click as { id, path, key } (nested steps carry their path) and the pane click clears it', async () => {
    const seen: Array<GraphSelection | null> = []
    const { container } = render(<FlowGraph graph={graph} onSelect={(s) => seen.push(s)} />)
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
})
