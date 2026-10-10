import { createWizard, inspect, type WizardEvent } from '@openwizard/core'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { type Deps, definePipeline, pipeline } from './pipeline'

/**
 * Fakes whose slow calls take virtual time on the SAME test scheduler the wizard uses, and
 * record a timeline — that is how the tests prove which branches overlapped.
 */
function fakeDeps(sched: TestScheduler, opts: { quality?: number } = {}) {
  const timeline: string[] = []
  const after = <T>(ms: number, value: T) =>
    new Promise<T>((resolve) => sched.setTimeout(() => resolve(value), ms))
  const track = async <T>(name: string, ms: number, value: T): Promise<T> => {
    timeline.push(`${name}:start@${sched.now()}`)
    const result = await after(ms, value)
    timeline.push(`${name}:end@${sched.now()}`)
    return result
  }
  const deps: Deps = {
    source: { fetch: () => ({ rows: 100 }) },
    normalizer: { run: (rows) => track('normalize', 300, { normalized: rows }) },
    enricher: {
      run: (rows) => track('enrich', 500, { enriched: rows, quality: opts.quality ?? 0.9 }),
    },
    warehouse: { write: () => ({ batchId: 'b-1' }) },
  }
  return { deps, timeline }
}

const settle = () => new Promise<void>((r) => setTimeout(r, 0))

function make(
  flow: typeof pipeline,
  quality?: number,
  context: { enrichment?: 'on' | 'off' } = {},
) {
  const sched = createTestScheduler({ now: 0 })
  const { deps, timeline } = fakeDeps(sched, quality === undefined ? {} : { quality })
  const wizard = createWizard(flow, {
    context: { source: 'crm-export', ...context },
    deps,
    scheduler: sched,
  })
  const events: WizardEvent<typeof pipeline>[] = []
  wizard.observe((e) => events.push(e))
  const of = <T extends WizardEvent['type']>(type: T) =>
    events.filter((e): e is Extract<WizardEvent<typeof pipeline>, { type: T }> => e.type === type)
  return { wizard, sched, deps, timeline, events, of }
}

describe('07 DAG pipeline: fan-out, parallel branches, AND-join, explain()', () => {
  it('runs both branches in parallel and lets the gate wait for both (dependsOn)', async () => {
    const { wizard, sched, timeline, of } = make(pipeline)

    // The static graph is what a visualizer consumes: next edges + dependsOn edges, no warnings.
    const graph = inspect(pipeline)
    expect(
      graph.edges.filter((e) => e.kind === 'dependsOn').map((e) => `${e.from}→${e.to}`),
    ).toEqual(['normalize→gate', 'enrich→gate'])
    expect(graph.edges.filter((e) => e.from === 'ingest').map((e) => e.to)).toEqual([
      'normalize',
      'enrich',
    ])
    expect(graph.warnings).toEqual([])

    await wizard.start() // ingest (sync) → fan-out → both branches start at once
    expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])
    expect(wizard.getState().active).toEqual(['normalize', 'enrich'])
    expect(wizard.getState().status).toBe('running')
    // Nothing arrived at the gate yet, and both dependencies are unmet.
    expect(wizard.explain('gate')).toMatchObject({
      status: 'idle',
      phase: undefined,
      reasons: ['not-activated', 'deps-unmet:normalize', 'deps-unmet:enrich'],
    })

    sched.advance(300) // normalize finishes and arrives at the gate …
    await settle()
    expect(wizard.getState().steps.normalize).toMatchObject({
      status: 'done',
      output: { normalized: 100 },
    })
    // … which is now activated but BLOCKED on the other branch.
    expect(wizard.explain('gate')).toMatchObject({
      status: 'idle',
      phase: 'blocked',
      reasons: ['deps-unmet:enrich'],
    })
    expect(wizard.getState().steps.gate.status).toBe('idle')

    sched.advance(200) // enrich finishes → the join is satisfied → gate → persist → done
    await settle()
    expect(timeline).toEqual([
      'normalize:start@0',
      'enrich:start@0',
      'normalize:end@300',
      'enrich:end@500',
    ])
    expect(wizard.getState().steps.gate.status).toBe('done')
    expect(wizard.getState().steps.persist).toMatchObject({
      status: 'done',
      output: { batchId: 'b-1' },
    })
    expect(wizard.getState().context).toEqual({
      source: 'crm-export',
      rows: 100,
      normalized: 100,
      enriched: 100,
      quality: 0.9,
      enrichment: 'on',
    })
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe('stored 100 rows')

    // Both runs started before either finished — parallel for real, not just "eventually both".
    const started = of('step.runStarted').map((e) => e.step)
    const finished = of('step.runSucceeded').map((e) => e.step)
    expect(started.slice(0, 3)).toEqual(['ingest', 'normalize', 'enrich'])
    expect(finished).toEqual(['ingest', 'normalize', 'enrich', 'persist'])
    wizard.dispose()
  })

  it('concurrency: 1 serialises the branches; explain() says concurrency-limit meanwhile', async () => {
    const serial = definePipeline({ concurrency: 1 })
    const { wizard, sched, timeline } = make(serial)
    await wizard.start()
    expect(timeline).toEqual(['normalize:start@0']) // arrival order: first in `next`
    expect(wizard.explain('enrich')).toMatchObject({
      status: 'idle',
      phase: 'ready',
      reasons: ['concurrency-limit'],
    })
    sched.advance(300)
    await settle()
    expect(timeline).toEqual(['normalize:start@0', 'normalize:end@300', 'enrich:start@300'])
    sched.advance(500)
    await settle()
    expect(timeline.at(-1)).toBe('enrich:end@800')
    expect(wizard.getState().status).toBe('done')
    wizard.dispose()
  })

  it("autoRun: 'manual' — nothing runs until runReady(); explain() says auto-run-manual", async () => {
    const manual = definePipeline({ concurrency: 2, autoRun: 'manual' })
    const { wizard, sched, timeline } = make(manual)
    await wizard.start()
    // Arrived and ready, but the host decides when work starts.
    expect(wizard.getState().steps.ingest.status).toBe('idle')
    expect(wizard.explain('ingest')).toMatchObject({ phase: 'ready', reasons: ['auto-run-manual'] })
    expect(wizard.getState().status).toBe('waiting')

    expect(await wizard.runReady()).toMatchObject({ ok: true }) // ingest runs (sync) → fan-out
    expect(wizard.getState().steps.ingest.status).toBe('done')
    expect(timeline).toEqual([]) // the branches wait for the next runReady()
    expect(wizard.explain('normalize').reasons).toEqual(['auto-run-manual'])
    expect(wizard.explain('enrich').reasons).toEqual(['auto-run-manual'])

    expect(await wizard.runReady()).toMatchObject({ ok: true }) // both branches start together
    expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])
    sched.advance(500)
    await settle()
    // Both done; the gate is arrived + satisfied but not started (manual applies to decisions too).
    expect(wizard.explain('gate')).toMatchObject({ phase: 'ready', reasons: ['auto-run-manual'] })
    expect(wizard.getState().status).toBe('waiting')

    // Drive the rest stage by stage until the flow is done.
    let rounds = 0
    while (wizard.getState().status !== 'done' && rounds < 5) {
      expect(await wizard.runReady()).toMatchObject({ ok: true })
      rounds += 1
    }
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe('stored 100 rows')
    wizard.dispose()
  })

  it('a decision routes on the merged context: low quality goes to quarantine', async () => {
    const { wizard, sched } = make(pipeline, 0.4)
    await wizard.start()
    sched.advance(500)
    await settle()
    expect(wizard.getState().steps.gate.status).toBe('done')
    expect(wizard.getState().steps.quarantine.status).toBe('done')
    expect(wizard.getState().steps.persist.status).toBe('idle')
    expect(wizard.getState().output).toBe('quarantined (quality 0.4)')
    wizard.dispose()
  })
  it('when: enrichment off skips the branch when it becomes ready; the AND-join treats skipped as done; progress() counts it', async () => {
    const { wizard, sched, timeline, of } = make(pipeline, undefined, { enrichment: 'off' })
    expect(wizard.progress()).toEqual({ done: 0, total: 5, ratio: 0 }) // finals excluded
    await wizard.start() // ingest → fan-out; enrich is ready → `when` false → skipped at once
    expect(of('step.skipped')).toHaveLength(1)
    expect(of('step.skipped')[0]).toMatchObject({ step: 'enrich', reason: 'when' })
    expect(wizard.getState().steps.enrich.status).toBe('skipped')
    expect(timeline).toEqual(['normalize:start@0']) // the enricher never ran
    expect(wizard.progress()).toEqual({ done: 2, total: 5, ratio: 0.4 }) // ingest done + enrich skipped
    // The gate is arrived (enrich's next still fires) and blocked on normalize only.
    expect(wizard.explain('gate')).toMatchObject({
      phase: 'blocked',
      reasons: ['deps-unmet:normalize'],
    })
    sched.advance(300)
    await settle()
    expect(wizard.getState().status).toBe('done')
    expect(wizard.getState().output).toBe('stored 100 rows')
    expect(wizard.progress()).toEqual({ done: 5, total: 5, ratio: 1 })
    wizard.dispose()
  })

  it('skip(): an operator skips the slow branch while it runs — cancelled, then skipped; the join proceeds', async () => {
    const { wizard, sched, timeline, of } = make(pipeline)
    await wizard.start()
    expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])
    expect(await wizard.skip('enrich', 'operator: enrichment down')).toMatchObject({ ok: true })
    expect(of('step.skipped').at(-1)).toMatchObject({ step: 'enrich', reason: 'command' })
    expect(wizard.getState().steps.enrich.status).toBe('skipped')
    expect(wizard.getState().active).toEqual(['normalize'])
    // A finished step cannot be skipped; a value, not a throw.
    expect(await wizard.skip('ingest')).toMatchObject({ ok: false })
    sched.advance(300)
    await settle()
    // No quality score arrived (enrich never wrote one) → the gate quarantines the batch.
    expect(wizard.getState().steps.gate.status).toBe('done')
    expect(wizard.getState().output).toBe('quarantined (quality 0)')
    // The enricher's late result is ignored (its run was cancelled).
    sched.advance(500)
    await settle()
    expect(wizard.getState().steps.enrich.status).toBe('skipped')
    expect(wizard.getState().context.enriched).toBeUndefined()
    expect(wizard.progress()).toEqual({ done: 4, total: 5, ratio: 1 }) // ratio is 1 once done
    wizard.dispose()
  })
})
