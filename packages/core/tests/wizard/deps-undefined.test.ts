import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import type { Boundary } from '../../src/authoring/types'
import {
  createRun,
  createRunAsync,
  resumeRun,
  resumeRunAsync,
} from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

const RAW_INPUT = { raw: true }

interface Reads {
  context: number
  deps: number
}

function createOptions(reads: Reads) {
  return {
    get context() {
      reads.context += 1
      if (reads.context > 1) throw new Error('context read twice')
      return {}
    },
    get deps() {
      reads.deps += 1
      if (reads.deps > 1) throw new Error('deps read twice')
      return RAW_INPUT
    },
  }
}

function resumeOptions(reads: Reads) {
  return {
    get deps() {
      reads.deps += 1
      if (reads.deps > 1) throw new Error('deps read twice')
      return RAW_INPUT
    },
  }
}

const unread = (): Reads => ({ context: 0, deps: 0 })

function makeFlow(deps: Boundary<unknown, unknown>, seen: unknown[]) {
  return defineWizard(
    { name: 'undefined-deps', context: boundary.trusted<{}>(), deps },
    ({ step, steps }) =>
      steps({
        task: step({
          run: ({ deps: parsed }) => {
            seen.push(parsed)
          },
          next: 'done',
        }),
        done: step({ next: null }),
      }),
  )
}

async function start(run: { start(): unknown; whenIdle(): Promise<void> }): Promise<void> {
  await run.start()
  await run.whenIdle()
}

describe('undefined parsed dependencies', () => {
  it('overrides raw deps at the sync create and resume doors', async () => {
    const seen: unknown[] = []
    const reads = [unread(), unread(), unread()]
    const flow = makeFlow(
      boundary.parse(() => undefined),
      seen,
    )
    const created = createRun(flow, createOptions(reads[0]!))
    await start(created)
    const seed = createRun(flow, createOptions(reads[1]!))
    const resumed = resumeRun(flow, seed.getSnapshot(), resumeOptions(reads[2]!))
    await start(resumed)
    expect(seen).toEqual([undefined, undefined])
    expect(reads).toEqual([
      { context: 1, deps: 1 },
      { context: 1, deps: 1 },
      { context: 0, deps: 1 },
    ])
  })

  it('overrides raw deps at the async create and resume doors', async () => {
    const seen: unknown[] = []
    const reads = [unread(), unread(), unread()]
    const deps: StandardSchemaV1<unknown, undefined> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async () => ({ value: undefined }),
      },
    }
    const flow = makeFlow(deps, seen)
    const created = await createRunAsync(flow, createOptions(reads[0]!))
    await start(created)
    const seed = await createRunAsync(flow, createOptions(reads[1]!))
    const resumed = await resumeRunAsync(flow, seed.getSnapshot(), resumeOptions(reads[2]!))
    await start(resumed)
    expect(seen).toEqual([undefined, undefined])
    expect(reads).toEqual([
      { context: 1, deps: 1 },
      { context: 1, deps: 1 },
      { context: 0, deps: 1 },
    ])
  })

  it('preserves inherited non-enumerable runtime options', async () => {
    let barriers = 0
    let writes = 0
    const store = {
      get: async () => null,
      set: async () => {
        writes += 1
      },
      delete: async () => undefined,
    }
    class Options {
      readonly context = {}
      get store() {
        return store
      }
      beforeEffects(): void {
        barriers += 1
      }
    }
    const flow = defineWizard(
      { name: 'inherited-options', context: boundary.trusted<{}>() },
      ({ step, steps }) => steps({ done: step({ next: null }) }),
    )
    const run = createRun(flow, new Options())
    await start(run)
    await run.save()

    expect(barriers).toBeGreaterThan(0)
    expect(writes).toBeGreaterThan(0)
  })
})
