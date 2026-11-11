/** A module projection follows dependency provisioning without accepting a separately authored twin. */
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import { defineProjection } from '../../src/projection/define-projection'
import { defineWizard } from '../../src/wizard/define-wizard'

function author() {
  return defineWizard(
    {
      name: 'provided-projection',
      context: boundary.trusted<{ id: string }>(),
      deps: boundary.trusted<{ prefix: string; suffix: string }>(),
    },
    ({ step, steps }) =>
      steps({
        work: step({
          run: ({ context, deps, progress }) => {
            const result = `${deps.prefix}${context.id}${deps.suffix}`
            progress(result)
            return result
          },
        }),
      }),
  )
}
const wizard = author()
const client = defineProjection(wizard, {
  expose: { output: true, steps: { work: { output: true, progress: true } } },
})

describe('provided wizard projections', () => {
  it('accepts a base module projection after chained provision and preserves that variant dependencies', async () => {
    const provided = wizard.provide({ prefix: 'left:' }).provide({ suffix: ':right' })
    const run = provided.create({ id: 'one' })
    expect(run.project(client).status).toBe('idle')
    const source = createMirrorSource(run, client)
    const mirror = createMirror<typeof client>({
      transport: createLocalTransport(source, { serialize: true }),
    })
    const values: unknown[] = []
    mirror.observe((event) => values.push(event.value))
    expect(await mirror.start()).toMatchObject({ ok: true })
    await run.awaitResult()

    expect(mirror.getSnapshot()?.output).toBe('left:one:right')
    expect(mirror.getSnapshot()?.steps.work.output).toBe('left:one:right')
    expect(values).toEqual(['left:one:right'])
    const snapshot = run.getSnapshot()
    mirror.dispose()
    source.dispose()
    run.dispose()
    const restored = provided.resume(snapshot)
    const restoredSource = createMirrorSource(restored, client)
    expect(restoredSource.getFrame().state.output).toBe('left:one:right')
    restoredSource.dispose()
    restored.dispose()
  })

  it('keeps separately authored same-name, same-shape wizards rejected after provisioning', () => {
    const provided = wizard.provide({ prefix: 'real:', suffix: ':real' })
    const run = provided.create({ id: 'one' })
    const foreign = defineProjection(author(), { expose: {} })

    expect(() => run.project(foreign)).toThrow('different authored definition')
    expect(() => createMirrorSource(run, foreign)).toThrow('different authored definition')
    run.dispose()
  })
})
