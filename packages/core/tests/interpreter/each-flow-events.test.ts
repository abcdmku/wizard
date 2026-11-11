import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { defineWizard } from '../../src/wizard/define-wizard'

describe('mapped child public event paths', () => {
  it('expands mapped ancestry at the root and rebases events for selected children', async () => {
    const leaf = defineWizard(
      { name: 'event-path-leaf', context: boundary.trusted<{ label: string }>() },
      ({ view, step, steps }) =>
        steps({
          form: view({ next: 'work' }),
          work: step({
            run({ context, progress }) {
              progress(context.label)
              return context.label
            },
          }),
        }),
    )
    const child = defineWizard(
      { name: 'event-path-child', context: boundary.trusted<{ label: string }>() },
      ({ flow, steps }) =>
        steps({
          inner: flow(leaf, {
            each: ({ context }) => [context.label],
            key: (item) => item,
            context: ({ item }) => ({ label: item }),
          }),
        }),
    )
    const wizard = defineWizard(
      { name: 'event-path-root', context: boundary.trusted<Record<string, never>>() },
      ({ flow, steps }) =>
        steps({
          outer: flow(child, {
            each: () => ['order/a'],
            key: (item) => item,
            context: ({ item }) => ({ label: item }),
          }),
        }),
    )
    const paths: { root: string[][]; child: string[][]; leaf: string[][] } = {
      root: [],
      child: [],
      leaf: [],
    }
    const run = wizard.create({}, { scheduler: createTestScheduler({ now: 1_000 }) })
    run.observe((event) => {
      if (event.type === 'step.progress' && event.step === 'work') paths.root.push([...event.path])
    })
    await run.start()
    const selected = run.child('outer', 'order/a')
    const selectedLeaf = selected.child('inner', 0)
    selected.observe((event) => {
      if (event.type === 'step.progress' && event.step === 'work') paths.child.push([...event.path])
    })
    selectedLeaf.observe((event) => {
      if (event.type === 'step.progress' && event.step === 'work') paths.leaf.push([...event.path])
    })
    expect(await selectedLeaf.next()).toMatchObject({ ok: true })
    expect((await run.awaitResult()).status).toBe('done')
    expect(paths).toEqual({
      root: [['outer', '0', 'inner', '0']],
      child: [['inner', '0']],
      leaf: [[]],
    })
    const workEvents = selectedLeaf
      .log()
      .filter((event) => 'step' in event && event.step === 'work')
    expect(workEvents.length).toBeGreaterThan(0)
    expect(workEvents.every((event) => event.path.length === 0)).toBe(true)
    run.dispose()
  })
})
