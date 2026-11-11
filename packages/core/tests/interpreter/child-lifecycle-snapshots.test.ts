import { describe, expect, it } from 'vitest'
import { flow, flowStep, runStep, view } from '../helpers/fixtures'
import { e2e, e2eResume, roundTrip } from '../wizard/e2e/harness'

describe('child snapshots follow committed parent lifecycle', () => {
  it('persists reset without retaining children that the reset disposes', async () => {
    let attempts = 0
    const child = flow({
      name: 'reset-child',
      start: 'work',
      steps: {
        work: runStep({
          run: () => {
            attempts++
            return new Promise(() => {})
          },
          idempotent: true,
        }),
      },
    })
    const parent = flow({ start: 'child', steps: { child: flowStep(child) } })
    const saved: unknown[] = []
    const t = e2e(parent, {
      beforeEffects: ({ snapshot, events }) => {
        if (events.some((event) => event.type === 'flow.reset')) saved.push(roundTrip(snapshot))
      },
    })
    await t.run.start()
    expect(attempts).toBe(1)
    expect(Object.keys(t.run.getSnapshot().children)).toEqual(['child'])
    await t.run.reset()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ state: { status: 'idle' }, children: {} })
    const snapshot = roundTrip(t.run.getSnapshot())
    t.run.dispose()
    const resumed = e2eResume(parent, snapshot)
    expect(resumed.run.getState().status).toBe('idle')
    expect(Object.keys(resumed.run.getSnapshot().children)).toEqual([])
    expect(attempts).toBe(1)
    resumed.run.dispose()
  })

  it('attaches every sibling before a restore dependency failure can commit', async () => {
    const child = flow({ name: 'restore-child', start: 'form', steps: { form: view() } })
    let rejectDeps = false
    const bad = flowStep(child)
    const parent = flow({
      start: ['bad', 'good'],
      steps: {
        bad: {
          ...bad,
          hooks: {
            ...bad.hooks,
            childDeps: () => {
              if (rejectDeps) throw new Error('restore deps failed')
              return {}
            },
          },
        },
        good: flowStep(child),
      },
    })
    const first = e2e(parent)
    await first.run.start()
    await first.run.child('good').setInput('form', { preserved: 'draft' })
    const snapshot = roundTrip(first.run.getSnapshot())
    first.run.dispose()
    rejectDeps = true
    const barriers: unknown[] = []
    const resumed = e2eResume(parent, snapshot, {
      beforeEffects: ({ snapshot: staged }) => {
        barriers.push(roundTrip(staged))
      },
    })
    await resumed.run.whenIdle()
    expect(barriers.length).toBeGreaterThan(0)
    expect(barriers[0]).toMatchObject({
      children: { good: { state: { steps: { form: { input: { preserved: 'draft' } } } } } },
    })
    expect(resumed.run.getState().status).toBe('halted')
    expect(resumed.run.getSnapshot().children.good?.state.steps.form?.input).toEqual({
      preserved: 'draft',
    })
    resumed.run.dispose()
  })
})
