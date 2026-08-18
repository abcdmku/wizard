/**
 * Headless run of the page: start the pipeline through the button, approve it, and see the
 * devtools panel follow — the graph cards take the live statuses, the events tab fills up, the
 * status line reaches `done`.
 */
import './test-setup'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { makeDeps } from './pipeline'
import { createPipelineWizard } from './wizard'

afterEach(cleanup)

const cardOf = (root: ParentNode, id: string) =>
  [...root.querySelectorAll<HTMLElement>('.owd-node-card')].find(
    (c) => c.querySelector('.owd-node-id')?.textContent === id,
  )

describe('10 devtools: the page drives the pipeline and the panel follows', () => {
  it('start → approve → done, with the graph overlay and the event log live', async () => {
    const wizard = createPipelineWizard(makeDeps(0))
    const { container } = render(<App wizard={wizard} />)
    // The panel is open by default and draws the wizard's own flow.
    await waitFor(() => expect(cardOf(container, 'ingest')).toBeDefined())
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    // Fake enricher fails once → retry (1.2 s) → then the gate → the approval wait.
    await waitFor(() => expect(cardOf(container, 'enrich')?.dataset.status).toBe('active'))
    await waitFor(() => expect(cardOf(container, 'approve')?.dataset.status).toBe('active'), {
      timeout: 5_000,
    })
    expect(cardOf(container, 'gate')?.dataset.status).toBe('done')
    fireEvent.click(screen.getByRole('button', { name: 'Send review.approved' }))
    await waitFor(() => expect(wizard.getState().status).toBe('done'))
    await waitFor(() => expect(cardOf(container, 'done')?.dataset.status).toBe('done'))
    expect(container.querySelector('.status code')?.textContent).toBe('done')
    // The events tab counted every event the wizard emitted.
    const eventsTab = screen.getByRole('button', { name: /^Events/ })
    expect(Number(eventsTab.querySelector('.owd-count')?.textContent)).toBe(wizard.log().length)
    wizard.dispose()
  }, 10_000)
})
