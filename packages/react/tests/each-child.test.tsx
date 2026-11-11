import { createMirror, createMirrorSource, type MirrorChild } from '@openwizard/core/mirror'
import { createLocalTransport } from '@openwizard/core/testing'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bindReact } from '../src'
import { type approval, batch, batchClient, serialBatch, serialClient } from './each-child-fixture'

afterEach(cleanup)

describe('indexed waiting child bindings', () => {
  it('switches local selection, sends only to that child, and reads retained state after disposal', async () => {
    const run = batch.create({ ids: ['alpha', '0'] })
    await run.start()
    const binding = bindReact<typeof batch>()
    let actions: MirrorChild<typeof approval> | undefined
    let renders = 0
    function Selected({ index }: { index: number }) {
      renders += 1
      const child = binding.useChild('batch', index)
      const snapshot = child.useSnapshot()
      actions = child.useActions()
      const record = child.useStep('approval')
      return (
        <p data-testid="selected">
          {snapshot?.context.id}:{snapshot?.status}:{record.phase ?? 'none'}:{record.output}
        </p>
      )
    }
    const ui = (index: number) => (
      <binding.Provider source={run}>
        <Selected index={index} />
      </binding.Provider>
    )
    const { rerender, unmount } = render(ui(0))
    expect(screen.getByTestId('selected').textContent).toBe('alpha:waiting:waiting:')
    rerender(ui(1))
    expect(screen.getByTestId('selected').textContent).toBe('0:waiting:waiting:')
    const beforeSibling = renders
    await act(async () => {
      await run.child('batch', 0).send('approved', { token: 'first' })
    })
    expect(renders).toBe(beforeSibling)
    expect(screen.getByTestId('selected').textContent).toBe('0:waiting:waiting:')
    expect(actions?.path).toEqual(['batch', '1'])
    await act(async () => {
      expect(await actions?.send('approved', { token: 'second' })).toMatchObject({ ok: true })
    })
    expect(screen.getByTestId('selected').textContent).toBe('0:done:none:second')
    expect(run.getState().output).toEqual(['first', 'second'])
    run.dispose()
    rerender(ui(0))
    expect(screen.getByTestId('selected').textContent).toBe('alpha:done:none:first')
    expect(await actions?.send('approved', { token: 'late' })).toMatchObject({
      ok: false,
      code: 'DISPOSED',
    })
    unmount()
  })

  it('reads an indexed projected child and sends a canonical child command through a Mirror', async () => {
    const run = batch.create({ ids: ['alpha', '0'] })
    await run.start()
    const source = createMirrorSource(run, batchClient)
    const mirror = createMirror<typeof batchClient>({
      transport: createLocalTransport(source, { serialize: true }),
    })
    const binding = bindReact<typeof batchClient>()
    let actions: MirrorChild<typeof approval> | undefined
    function Selected({ index }: { index: number }) {
      const child = binding.useChild('batch', index)
      const snapshot = child.useSnapshot()
      actions = child.useActions()
      return (
        <p data-testid="selected">
          {snapshot?.context.id ?? 'absent'}:{snapshot?.status}:{child.useStep('approval').output}
        </p>
      )
    }
    const ui = (index: number) => (
      <binding.Provider source={mirror}>
        <Selected index={index} />
      </binding.Provider>
    )
    const { rerender, unmount } = render(ui(1))
    expect(screen.getByTestId('selected').textContent).toBe('0:waiting:')
    expect(actions?.path).toEqual(['batch', '1'])
    await act(async () => {
      expect(
        await actions?.send('approved', { token: 'second' }, { eventId: 'approval-1' }),
      ).toMatchObject({ ok: true })
    })
    expect(screen.getByTestId('selected').textContent).toBe('0:done:second')
    expect(run.child('batch', 0).getState().status).toBe('waiting')
    rerender(ui(0))
    expect(screen.getByTestId('selected').textContent).toBe('alpha:waiting:')
    await act(async () => {
      expect(await actions?.send('approved', { token: 'first' })).toMatchObject({ ok: true })
    })
    expect(run.getState().output).toEqual(['first', 'second'])
    unmount()
    mirror.dispose()
    run.dispose()
  })

  it('shows a missing projected slot until limited concurrency starts that child', async () => {
    const run = serialBatch.create({ ids: ['first', 'second'] })
    await run.start()
    const source = createMirrorSource(run, serialClient)
    const mirror = createMirror<typeof serialClient>({
      transport: createLocalTransport(source, { serialize: true }),
    })
    const binding = bindReact<typeof serialClient>()
    function Second() {
      const child = binding.useChild('batch', 1)
      const snapshot = child.useSnapshot()
      if (snapshot === null) return <p data-testid="selected">not started</p>
      return <Record />
    }
    function Record() {
      const child = binding.useChild('batch', 1)
      const snapshot = child.useSnapshot()
      return (
        <p data-testid="selected">
          {snapshot?.context.id}:{child.useStep('approval').status}
        </p>
      )
    }
    const { unmount } = render(
      <binding.Provider source={mirror}>
        <Second />
      </binding.Provider>,
    )
    expect(screen.getByTestId('selected').textContent).toBe('not started')
    await act(async () => {
      await mirror.child('batch', 0).send('approved', { token: 'first' })
    })
    expect(screen.getByTestId('selected').textContent).toBe('second:active')
    unmount()
    mirror.dispose()
    run.dispose()
  })
})
