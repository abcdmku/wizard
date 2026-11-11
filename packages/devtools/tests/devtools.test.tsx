/**
 * `<Devtools>` end to end over a run and over a Mirror: the hotkey toggles the panel, the
 * graph tab draws the source's flow with the live overlay, the inspector shows the record +
 * `explain()` (run) or the projected facts + a note (Mirror), the events / timeline tabs are
 * live for a run and say why not for a Mirror.
 */
import { inspect } from '@openwizard/core/inspect'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Devtools } from '../src/devtools/Devtools'
import { StepInspector } from '../src/inspector/StepInspector'
import { context, makeMirror, makeRun, pipeline, runToWait, settle } from './fixture'

afterEach(cleanup)

const tab = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
const cardOf = (root: ParentNode, id: string) =>
  [...root.querySelectorAll<HTMLElement>('.owd-node-card')].find(
    (c) => c.querySelector('.owd-node-id')?.textContent === id,
  )
const fact = (root: ParentNode, key: string) =>
  [...root.querySelectorAll<HTMLElement>('.owd-kv')]
    .find((kv) => kv.querySelector('.owd-kv-key')?.textContent === key)
    ?.querySelector('.owd-kv-value')?.textContent

describe('<Devtools source={run}>', () => {
  it('toggles with ctrl+shift+d, overlays the live state on the graph and inspects a clicked step with explain()', async () => {
    const { run } = makeRun(async () => {
      throw new Error('boom')
    })
    await runToWait(run) // ingest failed once and waits for its retry (the test scheduler never advances)
    const { container } = render(<Devtools source={run} context={context} />)
    expect(container.querySelector('.owd-panel')).toBeNull()
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(container.querySelector('.owd-panel')).not.toBeNull())

    // Graph tab: the run's own flow, with the live overlay (form done, ingest active + retrying).
    await waitFor(() => expect(cardOf(container, 'ingest')?.dataset.status).toBe('active'))
    expect(cardOf(container, 'form')?.dataset.status).toBe('done')
    expect(
      cardOf(container, 'ingest')?.querySelector('.owd-status-dot')?.getAttribute('data-phase'),
    ).toBe('retrying')

    // Click a card → the inspector shows its record and why it is where it is.
    const ingest = cardOf(container, 'ingest')
    if (ingest === undefined) throw new Error('no card')
    fireEvent.click(ingest)
    fireEvent.click(tab('Inspector'))
    await waitFor(() =>
      expect(container.querySelector('.owd-inspector-title')?.textContent).toBe('ingest'),
    )
    expect(fact(container, 'attempt')).toBe('1')
    expect(fact(container, 'retryAt')).toBeDefined()
    expect([...container.querySelectorAll('.owd-chip-reason')].map((c) => c.textContent)).toContain(
      'retrying',
    )
    expect(fact(container, 'kind')).toBe('step')

    // Events tab is live; the timeline shows the live state and can scrub back to seq 0.
    fireEvent.click(tab('Events'))
    await waitFor(() =>
      expect(container.querySelectorAll('.owd-log-row').length).toBeGreaterThan(0),
    )
    fireEvent.click(tab('Timeline'))
    const slider = screen.getByLabelText('seq') as HTMLInputElement
    expect(slider.min).toBe('0')
    fireEvent.change(slider, { target: { value: '0' } })
    await waitFor(() => expect(container.querySelector('.owd-count-warn')).not.toBeNull())
    // While travelling, the graph overlay follows the replayed state (nothing active at seq 0).
    fireEvent.click(tab('Graph'))
    await waitFor(() => expect(cardOf(container, 'ingest')?.dataset.status).toBe('idle'))
    fireEvent.click(screen.getByLabelText('close devtools'))
    expect(container.querySelector('.owd-panel')).toBeNull()
    run.dispose()
  })
})

describe('<Devtools source={mirror} graph={inspect(flow)}>', () => {
  it('draws the graph from the projected state, inspects the projected facts, and explains what needs a run', async () => {
    const { run, mirror } = makeMirror()
    await runToWait(run)
    await settle()
    const { container } = render(<Devtools source={mirror} graph={inspect(pipeline)} defaultOpen />)
    await waitFor(() => expect(cardOf(container, 'awaitPayment')?.dataset.status).toBe('active'))
    expect(cardOf(container, 'gate')?.dataset.status).toBe('done')
    expect(container.querySelector('.owd-panel-meta')?.textContent).toContain('mirror')

    fireEvent.click(tab('Events'))
    expect(screen.getByText(/needs a run source/)).toBeTruthy()
    fireEvent.click(tab('Timeline'))
    expect(screen.getByText(/a Mirror source has none/)).toBeTruthy()

    fireEvent.click(tab('Inspector'))
    fireEvent.change(screen.getByLabelText('step'), { target: { value: 'ingest' } })
    await waitFor(() =>
      expect(container.querySelector('.owd-inspector-title')?.textContent).toBe('ingest'),
    )
    expect(fact(container, 'status')).toBe('done')
    expect(container.querySelector('.owd-json-pre')?.textContent).toContain('"rows": 100') // exposed output
    expect(screen.getByText('explain() needs a run source')).toBeTruthy()
    mirror.dispose()
    run.dispose()
  })
})

describe('<StepInspector> on its own', () => {
  it('reads a nested child step through the run snapshot and explains it through the child handle', async () => {
    const { run } = makeRun()
    await runToWait(run)
    await run.send('payment.captured', { paymentId: 'p1' })
    await settle()
    await settle()
    const { container } = render(
      <StepInspector source={run} step="count" path={['pack']} graph={inspect(pipeline)} />,
    )
    expect(container.querySelector('.owd-inspector-title')?.textContent).toBe('pack/count')
    expect(fact(container, 'status')).toBe('done')
    // explain() comes from `run.child('pack').explain('count')`: the child flow is terminal.
    expect([...container.querySelectorAll('.owd-chip-reason')].map((c) => c.textContent)).toContain(
      'run-terminal',
    )
    expect(container.querySelector('.owd-json-pre')?.textContent).toContain('200') // 100 rows × 2
    run.dispose()
  })
})
