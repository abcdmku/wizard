/** Optimistic edits follow indexed child arrays and clear only the edited fields' issues. */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createTestScheduler } from '../../src/interpreter/test-scheduler'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import { defineProjection } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'
import { tick } from './fixture'
import { reviews, reviewsClient } from './mapped-fixture'

async function flush(scheduler: ReturnType<typeof createTestScheduler>) {
  for (let hop = 0; hop < 4; hop++) {
    scheduler.advance(20)
    await tick()
  }
}

describe('optimistic projected child edits', () => {
  it('keeps arbitrary selected issue rows from making an optimistic command reject', async () => {
    const wizard = defineWizard(
      { name: 'selected-issue-shape', context: boundary.trusted<Record<string, never>>() },
      ({ view, steps }) => steps({ form: view({ input: boundary.trusted<{ note: string }>() }) }),
    )
    const issues = [null, { message: 'custom', path: null }, { message: 'custom', path: [null] }]
    const projection = defineProjection(wizard, {
      select: () => ({ steps: { form: { id: 'form', input: { note: '' }, issues } } }),
    })
    const run = wizard.create({})
    await run.start()
    const source = createMirrorSource(run, projection)
    const mirror = createMirror<typeof projection>({ transport: createLocalTransport(source) })
    const pending = mirror.setInput('form', { note: 'typed' })

    expect(mirror.getSnapshot()?.steps.form.input).toEqual({ note: 'typed' })
    expect(mirror.getSnapshot()?.steps.form.issues).toEqual(issues)
    expect(await pending).toMatchObject({ ok: true })
    mirror.dispose()
    source.dispose()
    run.dispose()
  })
  it('shows an indexed child draft before the server receives it and preserves its sibling', async () => {
    const run = reviews.create({ ids: ['left', 'right'] })
    await run.start()
    const source = createMirrorSource(run, reviewsClient)
    const scheduler = createTestScheduler()
    const mirror = createMirror<typeof reviewsClient>({
      initial: source.getFrame(),
      transport: createLocalTransport(source, { delayMs: 20, scheduler, serialize: true }),
    })
    const sibling = mirror.getSnapshot()?.steps.batch.child?.[0]
    const pending = mirror.child('batch', 1).setInput('form', { note: 'typed' })

    expect(mirror.getSnapshot()?.steps.batch.child?.[1]?.steps.form.input).toEqual({
      note: 'typed',
    })
    expect(run.child('batch', 1).getState().steps.form.input).toBeUndefined()
    expect(mirror.getSnapshot()?.steps.batch.child?.[0]).toBe(sibling)
    await flush(scheduler)
    expect(await pending).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.steps.batch.child?.[1]?.steps.form.input).toEqual({
      note: 'typed',
    })
    mirror.dispose()
    source.dispose()
    run.dispose()
  })

  it('removes a patched field issue immediately while retaining other fields and form issues', async () => {
    const wizard = defineWizard(
      { name: 'optimistic-issues', context: boundary.trusted<Record<string, never>>() },
      ({ view, steps }) =>
        steps({
          form: view({
            input: boundary.trusted<{ first: string; last: string }>(),
            initial: { first: '', last: '' },
            validate: ({ output }) => [
              ...(output.first === '' ? [{ message: 'first required', path: ['first'] }] : []),
              ...(output.last === '' ? [{ message: 'last required', path: ['last'] }] : []),
              { message: 'form review required' },
            ],
          }),
        }),
    )
    const projection = defineProjection(wizard, {
      expose: { steps: { form: { input: true, issues: true } } },
    })
    const run = wizard.create({})
    await run.start()
    await run.next()
    const source = createMirrorSource(run, projection)
    const scheduler = createTestScheduler()
    const mirror = createMirror<typeof projection>({
      initial: source.getFrame(),
      transport: createLocalTransport(source, { delayMs: 20, scheduler, serialize: true }),
    })
    const pending = mirror.setInput('form', { first: 'Ana' })
    const remaining = [
      { message: 'last required', path: ['last'] },
      { message: 'form review required' },
    ]
    expect(mirror.getSnapshot()?.steps.form.issues).toEqual(remaining)
    await flush(scheduler)
    expect(await pending).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.steps.form.issues).toEqual(remaining)
    mirror.dispose()
    source.dispose()
    run.dispose()
  })
})
