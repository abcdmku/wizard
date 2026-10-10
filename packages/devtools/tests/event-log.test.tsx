/**
 * `<EventLog>` live over a wizard: the `log()` seed and every later event (child events too)
 * become rows in seq order, the filter narrows them, a click hands the event back.
 */
import type { WizardEvent } from '@openwizard/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EventLog } from '../src/events/EventLog'
import { makeWizard, runToWait, settle } from './fixture'

afterEach(cleanup)

const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.owd-log-row')]
const typesOf = (root: HTMLElement) =>
  rows(root).map((r) => r.querySelector('.owd-log-type')?.textContent)
const counter = (root: HTMLElement) => root.querySelector('.owd-log-bar .owd-subtle')?.textContent
/** The rows are windowed: scroll the viewport so the window covers `row` (24 px per row). */
const scrollTo = (root: HTMLElement, row: number) => {
  const viewport = root.querySelector('.owd-log-viewport')
  if (viewport === null) throw new Error('no viewport')
  fireEvent.scroll(viewport, { target: { scrollTop: row * 24 } })
}

describe('<EventLog source={wizard}>', () => {
  it('shows the events already logged, then follows observe() — child events with their path', async () => {
    const { wizard } = makeWizard()
    await wizard.start()
    const seeded = wizard.log().length
    const { container } = render(<EventLog source={wizard} />)
    await waitFor(() => expect(counter(container)).toBe(`${seeded} events`))
    expect(typesOf(container)[0]).toBe('flow.started')

    await wizard.setInput('form', { name: 'ada' })
    await wizard.next()
    await settle()
    await settle()
    await wizard.send('payment.captured', { paymentId: 'p1' })
    await settle()
    await settle()
    await waitFor(() =>
      expect(Number.parseInt(counter(container) ?? '0', 10)).toBeGreaterThan(seeded + 10),
    )
    const total = Number.parseInt(counter(container) ?? '0', 10)
    // Only a window of rows is in the DOM; the head first, in seq order…
    expect(rows(container).length).toBeLessThan(total)
    const seqs = rows(container).map((r) => Number(r.firstElementChild?.textContent))
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    // …and after scrolling towards the end, the child flow's events with their path.
    scrollTo(container, total - 24)
    await waitFor(() => expect(rows(container).some((r) => r.dataset.child === 'true')).toBe(true))
    const childRow = rows(container).find((r) => r.dataset.child === 'true')
    expect(childRow?.children[4]?.textContent).toBe('pack')
    wizard.dispose()
  })

  it('filters by substring over type / step / event and reports the clicked event', async () => {
    const { wizard } = makeWizard()
    await runToWait(wizard)
    const picked: WizardEvent[] = []
    const { container } = render(<EventLog source={wizard} onSelect={(e) => picked.push(e)} />)
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(5))
    fireEvent.change(screen.getByLabelText('filter events'), { target: { value: 'runSucceeded' } })
    await waitFor(() =>
      expect(typesOf(container).every((t) => t === 'step.runSucceeded')).toBe(true),
    )
    expect(rows(container).length).toBeGreaterThanOrEqual(3) // ingest, normalize, enrich
    const first = rows(container)[0]
    if (first === undefined) throw new Error('no row')
    fireEvent.click(first)
    expect(picked[0]?.type).toBe('step.runSucceeded')
    expect(picked[0]?.seq).toBe(Number(first.firstElementChild?.textContent))
    fireEvent.change(screen.getByLabelText('filter events'), { target: { value: 'gate' } })
    await waitFor(() =>
      expect(rows(container).every((r) => r.textContent?.includes('gate'))).toBe(true),
    )
    wizard.dispose()
  })
})
