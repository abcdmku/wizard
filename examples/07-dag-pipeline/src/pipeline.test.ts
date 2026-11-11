import type { RunEvent } from '@openwizard/core'
import { inspect } from '@openwizard/core/inspect'
import { createTestScheduler, type TestScheduler } from '@openwizard/core/testing'
import { describe, expect, it } from 'vitest'
import { type Deps, definePipeline, pipeline } from './pipeline'

/**
 * Fakes whose slow calls take virtual time on the SAME test scheduler the run uses, and
 * record a timeline. That timeline is how the tests prove which branches overlapped.
 */
function fakeDeps(scheduler: TestScheduler, options: { quality?: number } = {}) {
  const timeline: string[] = []
  const after = <T>(ms: number, value: T) =>
    new Promise<T>((resolve) => scheduler.setTimeout(() => resolve(value), ms))
  const track = async <T>(name: string, ms: number, value: T): Promise<T> => {
    timeline.push(`${name}:start@${scheduler.now()}`)
    const result = await after(ms, value)
    timeline.push(`${name}:end@${scheduler.now()}`)
    return result
  }
  const deps: Deps = {
    source: { fetch: () => ({ rows: 100 }) },
    normalizer: { run: (rows) => track('normalize', 300, { normalized: rows }) },
    enricher: {
      run: (rows) => track('enrich', 500, { enriched: rows, quality: options.quality ?? 0.9 }),
    },
    warehouse: { write: () => ({ batchId: 'b-1' }) },
  }
  return { deps, timeline }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function make(
  flow: typeof pipeline,
  quality?: number,
  context: { enrichment?: 'on' | 'off' } = {},
) {
  const scheduler = createTestScheduler({ now: 0 })
  const { deps, timeline } = fakeDeps(scheduler, quality === undefined ? {} : { quality })
  const run = flow.create(
    { source: 'crm-export', ...context },
    {
      deps,
      scheduler: scheduler,
    },
  )
  const events: RunEvent<typeof pipeline>[] = []
  run.observe((event) => events.push(event))
  const eventsOfType = <T extends RunEvent<typeof pipeline>['type']>(type: T) =>
    events.filter(
      (event): event is Extract<RunEvent<typeof pipeline>, { type: T }> => event.type === type,
    )
  return { run, scheduler, deps, timeline, events, eventsOfType }
}

describe('07 DAG pipeline: fan-out, parallel branches, AND-join, explain()', () => {
  it('runs both branches in parallel and holds the join until both finish', async () => {
    const { run, scheduler, timeline, eventsOfType } = make(pipeline)

    // needs exposes both data dependencies and activation edges in the static graph.
    const graph = inspect(pipeline)
    expect(
      graph.edges
        .filter((edge) => edge.kind === 'needs' && edge.to === 'gate')
        .map((edge) => `${edge.from}→${edge.to}`),
    ).toEqual(['normalize→gate', 'enrich→gate'])
    expect(
      graph.edges
        .filter((edge) => edge.from === 'ingest' && edge.kind === 'needs')
        .map((edge) => edge.to),
    ).toEqual(['normalize', 'enrich'])
    expect(graph.warnings.map((warning) => warning.code)).toEqual(['MULTIPLE_SINKS'])

    await run.start() // ingest (sync) → fan-out → both branches start at once
    expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])
    expect(run.getState().active).toEqual(['normalize', 'enrich'])
    expect(run.getState().status).toBe('running')
    // Nothing arrived at the gate yet, and both dependencies are unmet.
    expect(run.explain('gate')).toMatchObject({
      status: 'idle',
      phase: undefined,
      reasons: ['not-activated', 'deps-unmet:normalize', 'deps-unmet:enrich'],
    })

    scheduler.advance(300) // normalize finishes; the gate still waits for enrichment.
    await settle()
    expect(run.getState().steps.normalize).toMatchObject({
      status: 'done',
      output: { normalized: 100 },
    })
    // The first completed producer activates the gate; unmet needs keep it blocked.
    expect(run.explain('gate')).toMatchObject({
      status: 'idle',
      phase: 'blocked',
      reasons: ['deps-unmet:enrich'],
    })
    expect(run.getState().steps.gate.status).toBe('idle')

    scheduler.advance(200) // enrich finishes → the join is satisfied → gate → persist → done
    await settle()
    expect(timeline).toEqual([
      'normalize:start@0',
      'enrich:start@0',
      'normalize:end@300',
      'enrich:end@500',
    ])
    expect(run.getState().steps.gate.status).toBe('done')
    expect(run.getState().steps.persist).toMatchObject({
      status: 'done',
      output: { batchId: 'b-1' },
    })
    expect(run.getState().context).toEqual({
      source: 'crm-export',
      rows: 100,
      normalized: 100,
      enriched: 100,
      quality: 0.9,
      enrichment: 'on',
    })
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe('stored 100 rows')

    // Both runs started before either finished, which proves the branches actually overlapped.
    const started = eventsOfType('step.runStarted').map((event) => event.step)
    // Hookless routing joins complete without reporting a task run.
    const finished = eventsOfType('step.done').map((event) => event.step)
    expect(started.slice(0, 3)).toEqual(['ingest', 'normalize', 'enrich'])
    expect(finished).toEqual(['ingest', 'normalize', 'enrich', 'gate', 'persist', 'done'])
    run.dispose()
  })

  it('serializes branches at concurrency 1 and explains why one is blocked', async () => {
    const serial = definePipeline({ concurrency: 1 })
    const { run, scheduler, timeline } = make(serial)
    await run.start()
    expect(timeline).toEqual(['normalize:start@0']) // arrival order: first in `next`
    expect(run.explain('enrich')).toMatchObject({
      status: 'idle',
      phase: 'ready',
      reasons: ['concurrency-limit'],
    })
    scheduler.advance(300)
    await settle()
    expect(timeline).toEqual(['normalize:start@0', 'normalize:end@300', 'enrich:start@300'])
    scheduler.advance(500)
    await settle()
    expect(timeline.at(-1)).toBe('enrich:end@800')
    expect(run.getState().status).toBe('done')
    run.dispose()
  })

  it('waits for startReady in manual mode and explains why ready steps are blocked', async () => {
    const manual = definePipeline({ concurrency: 2, autoRun: 'manual' })
    const { run, scheduler, timeline } = make(manual)
    await run.start()
    // Arrived and ready, but the host decides when work starts.
    expect(run.getState().steps.ingest.status).toBe('idle')
    expect(run.explain('ingest')).toMatchObject({ phase: 'ready', reasons: ['auto-run-manual'] })
    expect(run.getState().status).toBe('waiting')

    expect(await run.startReady()).toMatchObject({ ok: true }) // ingest runs (sync) → fan-out
    expect(run.getState().steps.ingest.status).toBe('done')
    expect(timeline).toEqual([]) // the branches wait for the next startReady()
    expect(run.explain('normalize').reasons).toEqual(['auto-run-manual'])
    expect(run.explain('enrich').reasons).toEqual(['auto-run-manual'])

    expect(await run.startReady()).toMatchObject({ ok: true }) // both branches start together
    expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])
    scheduler.advance(500)
    await settle()
    // Both done; the gate is arrived + satisfied but not started (manual applies to decisions too).
    expect(run.explain('gate')).toMatchObject({ phase: 'ready', reasons: ['auto-run-manual'] })
    expect(run.getState().status).toBe('waiting')

    // Drive the rest stage by stage until the flow is done.
    let rounds = 0
    while (run.getState().status !== 'done' && rounds < 5) {
      expect(await run.startReady()).toMatchObject({ ok: true })
      rounds += 1
    }
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe('stored 100 rows')
    run.dispose()
  })

  it('routes low-quality input to quarantine after merging branch results', async () => {
    const { run, scheduler } = make(pipeline, 0.4)
    await run.start()
    scheduler.advance(500)
    await settle()
    expect(run.getState().steps.gate.status).toBe('done')
    expect(run.getState().steps.quarantine.status).toBe('done')
    expect(run.getState().steps.persist.status).toBe('skipped')
    expect(run.getState().output).toBe('quarantined (quality 0.4)')
    run.dispose()
  })
  it('skips disabled enrichment and lets the join treat that branch as complete', async () => {
    const { run, scheduler, timeline, eventsOfType } = make(pipeline, undefined, {
      enrichment: 'off',
    })
    expect(run.progress()).toEqual({ done: 0, total: 7, ratio: 0 }) // all ordinary steps count
    await run.start() // ingest → fan-out; enrich is ready → `when` false → skipped at once
    expect(eventsOfType('step.skipped')).toHaveLength(1)
    expect(eventsOfType('step.skipped')[0]).toMatchObject({ step: 'enrich', reason: 'when' })
    expect(run.getState().steps.enrich.status).toBe('skipped')
    expect(timeline).toEqual(['normalize:start@0']) // the enricher never ran
    expect(run.progress()).toEqual({ done: 2, total: 7, ratio: 2 / 7 }) // ingest done + enrich skipped
    // Skipped enrichment activates the gate with undefined; normalize still gates readiness.
    expect(run.explain('gate')).toMatchObject({
      phase: 'blocked',
      reasons: ['deps-unmet:normalize'],
    })
    scheduler.advance(300)
    await settle()
    expect(run.getState().status).toBe('done')
    expect(run.getState().output).toBe('stored 100 rows')
    // Declared untaken targets count as skipped, so every node reaches a settled state.
    expect(run.progress()).toEqual({ done: 7, total: 7, ratio: 1 })
    run.dispose()
  })

  it('cancels a running branch when an operator skips it, then continues the join', async () => {
    const { run, scheduler, timeline, eventsOfType } = make(pipeline)
    await run.start()
    expect(timeline).toEqual(['normalize:start@0', 'enrich:start@0'])
    expect(await run.skip('enrich', 'operator: enrichment down')).toMatchObject({ ok: true })
    expect(eventsOfType('step.skipped').at(-1)).toMatchObject({ step: 'enrich', reason: 'command' })
    expect(run.getState().steps.enrich.status).toBe('skipped')
    expect(run.getState().active).toEqual(['normalize'])
    // A finished step cannot be skipped; a value, not a throw.
    expect(await run.skip('ingest')).toMatchObject({ ok: false })
    scheduler.advance(300)
    await settle()
    // No quality score arrived (enrich never wrote one) → the gate quarantines the batch.
    expect(run.getState().steps.gate.status).toBe('done')
    expect(run.getState().output).toBe('quarantined (quality 0)')
    // The enricher's late result is ignored (its run was cancelled).
    scheduler.advance(500)
    await settle()
    expect(run.getState().steps.enrich.status).toBe('skipped')
    expect(run.getState().context.enriched).toBeUndefined()
    expect(run.progress()).toEqual({ done: 7, total: 7, ratio: 1 })
    run.dispose()
  })
})
