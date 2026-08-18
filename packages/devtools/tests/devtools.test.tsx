/**
 * `<Devtools>` end to end over a wizard and over a Mirror: the hotkey toggles the panel, the
 * graph tab draws the source's flow with the live overlay, the inspector shows the record +
 * `explain()` (wizard) or the projected facts + a note (Mirror), the events / timeline tabs are
 * live for a wizard and say why not for a Mirror.
 */
import { inspect } from '@openwizard/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Devtools } from '../src/devtools/Devtools'
import { StepInspector } from '../src/inspector/StepInspector'
import { context, makeMirror, makeWizard, pipeline, runToWait, settle } from './fixture'

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

describe('<Devtools source={wizard}>', () => {
  it('toggles with ctrl+shift+d, overlays the live state on the graph and inspects a clicked step with explain()', async () => {
    const { wizard } = makeWizard(async () => {
      throw new Error('boom')
    })
    await runToWait(wizard) // ingest failed once and waits for its retry (the test scheduler never advances)
    const { container } = render(<Devtools source={wizard} context={context} />)
    expect(container.querySelector('.owd-panel')).toBeNull()
    fireEvent.keyDown(document, { key: 'd', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(container.querySelector('.owd-panel')).not.toBeNull())

    // Graph tab: the wizard's own flow, with the live overlay (form done, ingest active + retrying).
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
    expect(fact(container, 'kind')).toBe('task')

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
    wizard.dispose()
  })
})

describe('<Devtools source={mirror} graph={inspect(flow)}>', () => {
  it('draws the graph from the projected state, inspects the projected facts, and explains what needs a wizard', async () => {
    const { wizard, mirror } = makeMirror()
    await runToWait(wizard)
    await settle()
    const { container } = render(<Devtools source={mirror} graph={inspect(pipeline)} defaultOpen />)
    await waitFor(() => expect(cardOf(container, 'awaitPayment')?.dataset.status).toBe('active'))
    expect(cardOf(container, 'gate')?.dataset.status).toBe('done')
    expect(container.querySelector('.owd-panel-meta')?.textContent).toContain('mirror')

    fireEvent.click(tab('Events'))
    expect(screen.getByText(/needs a wizard source/)).toBeTruthy()
    fireEvent.click(tab('Timeline'))
    expect(screen.getByText(/a Mirror source has none/)).toBeTruthy()

    fireEvent.click(tab('Inspector'))
    fireEvent.change(screen.getByLabelText('step'), { target: { value: 'ingest' } })
    await waitFor(() =>
      expect(container.querySelector('.owd-inspector-title')?.textContent).toBe('ingest'),
    )
    expect(fact(container, 'status')).toBe('done')
    expect(container.querySelector('.owd-json-pre')?.textContent).toContain('"rows": 100') // exposed output
    expect(screen.getByText('explain() needs a wizard source')).toBeTruthy()
    mirror.dispose()
    wizard.dispose()
  })
})

describe('<StepInspector> on its own', () => {
  it('reads a nested child step through the wizard snapshot and explains it through the child handle', async () => {
    const { wizard } = makeWizard()
    await runToWait(wizard)
    await wizard.send('payment.captured', { paymentId: 'p1' })
    await settle()
    await settle()
    const { container } = render(
      <StepInspector source={wizard} step="count" path={['pack']} graph={inspect(pipeline)} />,
    )
    expect(container.querySelector('.owd-inspector-title')?.textContent).toBe('pack/count')
    expect(fact(container, 'status')).toBe('done')
    // explain() comes from `wizard.child('pack').explain('count')`: the child flow is terminal.
    expect([...container.querySelectorAll('.owd-chip-reason')].map((c) => c.textContent)).toContain(
      'flow-terminal',
    )
    expect(container.querySelector('.owd-json-pre')?.textContent).toContain('200') // 100 rows × 2
    wizard.dispose()
  })
})
