import { inspect } from '@openwizard/core/inspect'
import { createMirror, createMirrorSource } from '@openwizard/core/mirror'
import { createLocalTransport } from '@openwizard/core/testing'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { FlowGraph, type GraphSelection, overlayOf, StepInspector } from '../src'
import { readStep } from '../src/inspector/read-step'
import { mappedParent, mappedProjection } from './mapped-fixture'

afterEach(cleanup)

const fact = (root: HTMLElement, key: string) =>
  [...root.querySelectorAll<HTMLElement>('.owd-kv')]
    .find((row) => row.querySelector('.owd-kv-key')?.textContent === key)
    ?.querySelector('.owd-kv-value')?.textContent

it('reads each child by index, preserving numeric authored ids and item-specific graph selection', async () => {
  const run = mappedParent.create({ names: ['ada', 'grace'] })
  await run.start()
  await run.whenIdle()
  const snapshot = run.getSnapshot()
  const overlay = overlayOf(run, snapshot)
  expect(overlay.childPaths).toEqual([
    ['batch', '0'],
    ['batch', '0', '0'],
    ['batch', '1'],
    ['batch', '1', '0'],
  ])
  expect(overlay.statuses['batch/0/0/form']).toEqual({ status: 'active', phase: 'waiting' })
  expect(overlay.statuses['batch/1/0/form']).toEqual({ status: 'active', phase: 'waiting' })
  expect(Object.keys(overlay.statuses).some((key) => key.includes('@each'))).toBe(false)
  const graph = inspect(mappedParent)
  const selected: GraphSelection[] = []
  const view = render(
    <FlowGraph
      graph={graph}
      childPaths={overlay.childPaths}
      statuses={overlay.statuses}
      onSelect={(value) => {
        if (value !== null) selected.push(value)
      }}
    />,
  )
  await waitFor(() =>
    expect(
      view.container.querySelector('[data-id="batch/1/0/form"] .owd-node-card'),
    ).not.toBeNull(),
  )
  const form = view.container.querySelector('[data-id="batch/1/0/form"] .owd-node-card')
  if (form === null) throw new Error('no indexed child form')
  fireEvent.click(form)
  expect(selected).toEqual([{ id: 'form', path: ['batch', '1', '0'], key: 'batch/1/0/form' }])
  await run.child('batch', 1).child('0').setInput('form', { confirmed: true })
  view.rerender(<StepInspector source={run} step="form" path={['batch', '1', '0']} graph={graph} />)
  expect(fact(view.container, 'phase')).toBe('waiting')
  expect(fact(view.container, 'kind')).toBe('view')
  expect(view.container.querySelector('.owd-json-pre')?.textContent).toContain('"confirmed": true')
  expect(readStep(run, run.getSnapshot(), ['batch', '0', '0'], 'form').record?.input).toEqual({
    confirmed: false,
  })
  run.dispose()
  expect(readStep(run, run.getSnapshot(), ['batch', '1', '0'], 'form').record?.input).toEqual({
    confirmed: true,
  })
})

it('reads indexed child arrays from a mirror without confusing the numeric nested flow id', async () => {
  const run = mappedParent.create({ names: ['ada', 'grace'] })
  const source = createMirrorSource(run, mappedProjection)
  const mirror = createMirror<typeof mappedProjection>({
    transport: createLocalTransport(source, { serialize: true }),
  })
  await run.start()
  await run.whenIdle()
  await run.child('batch', 1).child('0').setInput('form', { confirmed: true })
  await waitFor(() =>
    expect(
      readStep(mirror, mirror.getSnapshot(), ['batch', '1', '0'], 'form').projected?.input,
    ).toEqual({ confirmed: true }),
  )
  const overlay = overlayOf(mirror, mirror.getSnapshot())
  expect(overlay.statuses['batch/1']).toEqual({ status: 'active' })
  expect(overlay.statuses['batch/0/0/form']).toEqual({ status: 'active', phase: 'waiting' })
  expect(overlay.statuses['batch/1/0/form']).toEqual({ status: 'active', phase: 'waiting' })
  mirror.dispose()
  source.dispose()
  run.dispose()
})
