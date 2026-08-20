/**
 * Headless run of the page: start the pipeline through the button, approve it, and see the
 * devtools panel follow. The graph cards take the live statuses, the events tab fills up, the
 * status line reaches `done`.
 */
import './test-setup'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { makeDeps } from './pipeline'
import { createPipelineRun } from './wizard'

afterEach(cleanup)

const cardOf = (root: ParentNode, id: string) =>
  [...root.querySelectorAll<HTMLElement>('.owd-node-card')].find(
    (node) => node.querySelector('.owd-node-id')?.textContent === id,
  )

describe('10 devtools: the page drives the pipeline and the panel follows', () => {
  it('moves through approval while the graph and event log update', async () => {
    const run = createPipelineRun(makeDeps(0))
    const { container } = render(<App run={run} />)
    // The panel is open by default and draws the run's own flow.
    await waitFor(() => expect(cardOf(container, 'ingest')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    // Fake enricher fails once → retry (1.2 s) → then the gate → the approval wait.
    await waitFor(() => expect(cardOf(container, 'enrich')?.dataset.status).toBe('active'))
    await waitFor(() => expect(cardOf(container, 'approve')?.dataset.status).toBe('active'), {
      timeout: 5_000,
    })
    expect(cardOf(container, 'gate')?.dataset.status).toBe('done')
    fireEvent.click(screen.getByRole('button', { name: 'Send review.approved' }))
    await waitFor(() => expect(run.getState().status).toBe('done'))
    await waitFor(() => expect(cardOf(container, 'done')?.dataset.status).toBe('done'))
    expect(container.querySelector('.status code')?.textContent).toBe('done')
    // The events tab counted every event the run emitted.
    const eventsTab = screen.getByRole('button', { name: /^Events/ })
    expect(Number(eventsTab.querySelector('.owd-count')?.textContent)).toBe(run.log().length)
    run.dispose()
  }, 10_000)
})
