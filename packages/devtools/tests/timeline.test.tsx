/**
 * `<Timeline>`: scrubbing to an earlier seq shows the state the wizard had then (the same state
 * `replay` computes), `onScrub` hands it out, "live" snaps back; mounted late, `context` still
 * gives the whole range while the log starts at seq 1.
 */
import { replay } from '@openwizard/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReplayState } from '../src/timeline/replay-window'
import { Timeline } from '../src/timeline/Timeline'
import { context, makeWizard, pipeline, runToWait, settle } from './fixture'

afterEach(cleanup)

const slider = () => screen.getByLabelText('seq') as HTMLInputElement
const value = (container: HTMLElement, key: string) =>
  [...container.querySelectorAll<HTMLElement>('.owd-kv')]
    .find((kv) => kv.querySelector('.owd-kv-key')?.textContent === key)
    ?.querySelector('.owd-kv-value')?.textContent

describe('<Timeline>', () => {
  it('mounted before start(): scrubs the whole history and hands the replayed state to onScrub', async () => {
    const { wizard } = makeWizard()
    const seen: Array<{ state: ReplayState | null; seq: number }> = []
    const { container } = render(
      <Timeline source={wizard} onScrub={(state, seq) => seen.push({ state, seq })} />,
    )
    expect(slider().min).toBe('0')
    await runToWait(wizard)
    await settle()
    const latest = wizard.getState().seq
    await waitFor(() => expect(slider().max).toBe(String(latest)))
    expect(value(container, 'status')).toBe('waiting')
    expect(value(container, 'active')).toBe('awaitPayment')

    // Right after the first transition committed: the form is the current view.
    const afterStart = wizard
      .log()
      .find((e) => e.type === 'transition.committed' && (e as { to?: string }).to === 'form')?.seq
    if (afterStart === undefined) throw new Error('no transition.committed to form')
    fireEvent.change(slider(), { target: { value: String(afterStart) } })
    await waitFor(() => expect(value(container, 'current')).toBe('form'))
    expect(value(container, 'status')).toBe('waiting')
    const expected = replay(pipeline, wizard.log(), {
      context,
      instanceId: wizard.id,
      upTo: afterStart,
    })
    expect(seen.at(-1)?.state).toEqual(expected)
    expect(seen.at(-1)?.seq).toBe(afterStart)
    expect(container.querySelector('.owd-step-chip[data-status="active"]')?.textContent).toBe(
      'form',
    )

    // Step forward one seq, then back to live.
    fireEvent.click(screen.getByLabelText('next'))
    await waitFor(() => expect(seen.at(-1)?.seq).toBe(afterStart + 1))
    fireEvent.click(screen.getByLabelText('live'))
    await waitFor(() => expect(seen.at(-1)?.state).toBeNull())
    expect(value(container, 'active')).toBe('awaitPayment')
    wizard.dispose()
  })

  it('mounted late without context: the range starts where it attached; with context: from seq 0', async () => {
    const { wizard } = makeWizard()
    await runToWait(wizard)
    const attachedAt = wizard.getState().seq
    const late = render(<Timeline source={wizard} />)
    expect(slider().min).toBe(String(attachedAt))
    expect(late.container.querySelector('.owd-note')?.textContent).toContain(
      `starts at seq ${attachedAt}`,
    )
    cleanup()
    render(<Timeline source={wizard} context={context} />)
    expect(slider().min).toBe('0')
    fireEvent.change(slider(), { target: { value: '0' } })
    await waitFor(() => expect(value(document.body, 'status')).toBe('idle'))
    wizard.dispose()
  })
})
